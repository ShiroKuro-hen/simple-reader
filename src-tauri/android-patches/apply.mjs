// Adds "Open with" / "Share" to the Android project that `tauri android init --ci` generates (gen/ is not committed).
// Usage: node src-tauri/android-patches/apply.mjs [path/to/gen/android]
// Every step asserts what it expects to find and exits non-zero otherwise, so a Tauri template change fails CI loudly.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const android = resolve(process.argv[2] ?? join(here, '../gen/android'));
const pkg = JSON.parse(readFileSync(join(here, '../tauri.conf.json'), 'utf8')).identifier;
const main = join(android, 'app/src/main');

function die(msg) {
  console.error(`android-patches: ${msg}`);
  process.exit(1);
}
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
/** Replaces exactly one occurrence of `from`. */
function swap(text, from, to, what) {
  if (text.split(from).length !== 2) die(`expected exactly one ${what} (${JSON.stringify(from)})`);
  return text.replace(from, () => to);
}

// 1. MainActivity.kt: queue the intent on cold start and on onNewIntent, expose the bridge to the WebView.
const activities = walk(main).filter((f) => f.endsWith('/MainActivity.kt') || f.endsWith('\\MainActivity.kt'));
if (activities.length !== 1) die(`expected one MainActivity.kt under ${main}, found ${activities.length}`);
const activityPath = activities[0];
let kt = readFileSync(activityPath, 'utf8');
if (kt.includes('Incoming.')) die('MainActivity.kt is already patched');
kt = swap(kt, 'super.onCreate(savedInstanceState)', 'super.onCreate(savedInstanceState)\n    if (savedInstanceState == null) Incoming.add(this, intent) // a restored activity must not import its old intent again', 'super.onCreate call');
kt = swap(
  kt,
  /class MainActivity : TauriActivity\(\) \{\n/.exec(kt)?.[0] ?? die('MainActivity does not extend TauriActivity'),
  `class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    Incoming.attach(webView)
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    Incoming.add(this, intent)
  }

`,
  'class MainActivity line',
);
writeFileSync(activityPath, kt);
writeFileSync(join(dirname(activityPath), 'Incoming.kt'), readFileSync(join(here, 'Incoming.kt'), 'utf8').replace('__PKG__', pkg));
if (!new RegExp(`^package ${pkg.replaceAll('.', '\\.')}$`, 'm').test(kt)) die(`MainActivity.kt is not in package ${pkg}`);

// 2. AndroidManifest.xml: the filters, inside MainActivity.
const manifestPath = join(main, 'AndroidManifest.xml');
let xml = readFileSync(manifestPath, 'utf8');
if (!xml.includes('android:name=".MainActivity"')) die('MainActivity not found in AndroidManifest.xml');
const VIEW = `<action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />`;
const filters = String.raw`<!-- simple-reader: Open with / Share -->
            <intent-filter>
                ${VIEW}
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="application/pdf" />
            </intent-filter>
            <intent-filter>
                ${VIEW}
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="application/octet-stream" />
                <data android:pathPattern=".*\\.epub" />
                <data android:pathPattern=".*\\.pdf" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/octet-stream" />
            </intent-filter>
        </activity>`;
xml = swap(xml, '</activity>', filters, '</activity>');
writeFileSync(manifestPath, xml);
console.log(`android-patches: patched ${activityPath} and ${manifestPath}`);
