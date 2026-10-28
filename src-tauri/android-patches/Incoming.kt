package __PKG__

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream

/**
 * Files handed to the app by "Open with" (ACTION_VIEW) and "Share" (ACTION_SEND / SEND_MULTIPLE).
 * Copied in by apply.mjs next to MainActivity. The page sees this object as window.SRIntent and pulls
 * the bytes in chunks (src/native/incoming.ts); which files are books is decided there (src/native/intake.ts).
 */
object Incoming {
  private class Item(val id: Int, val uri: Uri, val name: String?, val mime: String?)

  private var nextId = 1
  private var context: Context? = null
  private var webView: WebView? = null
  private val pending = ArrayList<Item>() // queued, not yet listed to the page
  private val items = HashMap<Int, Item>() // listed, readable by id
  private val streams = HashMap<Int, InputStream>()
  private var folder: String? = null // the picked folder's books, until the page takes them (the system may have restarted the app meanwhile)
  private const val PICK_FOLDER = 4242
  private val BOOK = Regex(""".*\.(epub|pdf|cbz|cbr)$""", RegexOption.IGNORE_CASE)

  fun attach(view: WebView) {
    webView = view
    view.addJavascriptInterface(this, "SRIntent") // before the page loads, so it exists from its first line
  }

  private fun displayName(resolver: android.content.ContentResolver, uri: Uri): String? {
    val queried = try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    } catch (e: Exception) {
      null
    }
    return queried ?: uri.lastPathSegment
  }

  /** Queue what `intent` carries and tell the page, if it is already there (otherwise it asks when it loads). */
  @Synchronized
  @Suppress("DEPRECATION")
  fun add(ctx: Context, intent: Intent?) {
    val i = intent ?: return
    context = ctx.applicationContext
    val uris: List<Uri?> = when (i.action) {
      Intent.ACTION_VIEW -> listOf(i.data)
      Intent.ACTION_SEND -> listOf(i.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
      Intent.ACTION_SEND_MULTIPLE -> i.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
      else -> emptyList()
    }
    val resolver = ctx.contentResolver
    uris.filterNotNull().distinct().forEach { uri ->
      pending.add(Item(nextId++, uri, displayName(resolver, uri), resolver.getType(uri) ?: i.type))
    }
    if (pending.isNotEmpty()) webView?.post { webView?.evaluateJavascript("window.__srIncoming&&window.__srIncoming()", null) }
  }

  /** The WebView cannot pick a folder: the page asks for the system's folder picker. The answer comes to folderPicked. */
  @JavascriptInterface
  fun pickFolder() {
    val activity = webView?.context as? Activity ?: return
    activity.runOnUiThread { activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), PICK_FOLDER) }
  }

  /** Walks the picked folder and keeps its books as [{id, path}] ("Folder/sub/file.ext"; [] when cancelled) for takeFolder. */
  @Synchronized
  fun folderPicked(ctx: Context, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PICK_FOLDER) return
    context = ctx.applicationContext
    val out = JSONArray()
    val tree = data?.data
    if (resultCode == Activity.RESULT_OK && tree != null) {
      val resolver = ctx.contentResolver
      val root = DocumentsContract.getTreeDocumentId(tree)
      fun walk(parentId: String, path: String) {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)
        resolver.query(children, columns, null, null, null)?.use { c ->
          while (c.moveToNext()) {
            val id = c.getString(0)
            val name = c.getString(1) ?: continue
            if (c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) walk(id, "$path/$name")
            else if (BOOK.matches(name)) {
              val item = Item(nextId++, DocumentsContract.buildDocumentUriUsingTree(tree, id), name, null)
              items[item.id] = item
              out.put(JSONObject().put("id", item.id).put("path", "$path/$name"))
            }
          }
        }
      }
      // The folder's own name is the first path segment, as webkitRelativePath has it on the web.
      val rootName = resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, root), arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "Folder"
      walk(root, rootName)
    }
    folder = out.toString()
    webView?.post { webView?.evaluateJavascript("window.__srFolder&&window.__srFolder()", null) }
  }

  @Synchronized
  @JavascriptInterface
  fun takeFolder(): String = (folder ?: "[]").also { folder = null }

  /** JSON [{id, name, mime}] of the files queued since the last call. */
  @Synchronized
  @JavascriptInterface
  fun list(): String {
    val out = JSONArray()
    for (p in pending) {
      items[p.id] = p
      out.put(JSONObject().put("id", p.id).put("name", p.name ?: JSONObject.NULL).put("mime", p.mime ?: JSONObject.NULL))
    }
    pending.clear()
    return out.toString()
  }

  /** Next chunk of file `id` as base64, "" at the end, null if it cannot be read. */
  @Synchronized
  @JavascriptInterface
  fun read(id: Int, max: Int): String? = try {
    val stream = streams.getOrPut(id) { context!!.contentResolver.openInputStream(items[id]!!.uri)!! }
    val buf = ByteArray(max)
    val n = stream.read(buf)
    if (n <= 0) "" else Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
  } catch (e: Exception) {
    null
  }

  @Synchronized
  @JavascriptInterface
  fun close(id: Int) {
    try {
      streams.remove(id)?.close()
    } catch (e: Exception) {
    }
    items.remove(id)
  }
}
