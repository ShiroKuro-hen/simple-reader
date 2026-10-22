package __PKG__

import android.content.Context
import android.content.Intent
import android.net.Uri
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
