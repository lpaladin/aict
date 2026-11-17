"""Overlay this project's source-built classes onto the official independent runtime."""
import hashlib
import json
import shutil
import xml.etree.ElementTree as ET
import zipfile
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TREE = ROOT / '.build/template'
NS = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', NS)
def a(name): return '{' + NS + '}' + name

metadata = TREE / 'apktool.yml'
yaml = metadata.read_text(encoding='utf-8')
yaml = re.sub(r'(?m)^(\s*minSdkVersion:) .+$', r'\1 26', yaml)
yaml = re.sub(r'(?m)^(\s*versionCode:) .+$', r'\1 5', yaml)
yaml = re.sub(r'(?m)^(\s*versionName:) .+$', r'\1 0.4.1', yaml)
metadata.write_text(yaml, encoding='utf-8')

manifest = ET.parse(TREE / 'AndroidManifest.xml')
root = manifest.getroot()
# Keep the upstream package: the independent runtime's BuildConfig and resource
# references are compiled for it. The app is re-signed with this project's key.
app = root.find('application')
app.set(a('label'), 'AIct')
app.set(a('theme'), '@android:style/Theme.Material.Light.NoActionBar')
for activity in app.findall('activity'):
    for intent in activity.findall('intent-filter'):
        if any(c.get(a('name')) == 'android.intent.category.LAUNCHER' for c in intent.findall('category')):
            activity.remove(intent)

for name in ('android.permission.FOREGROUND_SERVICE_SPECIAL_USE', 'android.permission.BLUETOOTH_CONNECT', 'android.permission.BLUETOOTH_SCAN'):
    if not any(p.get(a('name')) == name for p in root.findall('uses-permission')):
        ET.SubElement(root, 'uses-permission', {a('name'): name})

for name in ('MainActivity', 'PermissionsActivity', 'CaptureActivity'):
    existing = [x for x in app.findall('activity') if x.get(a('name')) == 'dev.aict.container.' + name]
    for element in existing: app.remove(element)
    element = ET.SubElement(app, 'activity', {a('name'): 'dev.aict.container.' + name,
        a('exported'): 'true' if name == 'MainActivity' else 'false',
        a('theme'): '@android:style/Theme.Material.Light.NoActionBar'})
    if name == 'MainActivity':
        element.set(a('configChanges'), 'keyboardHidden|orientation|screenSize|uiMode')
        intent = ET.SubElement(element, 'intent-filter')
        ET.SubElement(intent, 'action', {a('name'): 'android.intent.action.MAIN'})
        ET.SubElement(intent, 'category', {a('name'): 'android.intent.category.LAUNCHER'})
    if name == 'CaptureActivity':
        element.set(a('configChanges'), 'orientation|screenSize')

for service in list(app.findall('service')):
    if service.get(a('name'), '').startswith('dev.aict.container.'):
        app.remove(service)
service = ET.SubElement(app, 'service', {a('name'): 'dev.aict.container.ConnectionService',
    a('exported'): 'false', a('foregroundServiceType'): 'specialUse'})
ET.SubElement(service, 'property', {a('name'): 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
    a('value'): 'User-visible SSH connection and trusted remote native script execution'})
service = ET.SubElement(app, 'service', {a('name'): 'dev.aict.container.VisionService',
    a('label'): 'AIct Vision', a('exported'): 'true', a('permission'): 'android.permission.BIND_ACCESSIBILITY_SERVICE'})
intent = ET.SubElement(service, 'intent-filter')
ET.SubElement(intent, 'action', {a('name'): 'android.accessibilityservice.AccessibilityService'})
ET.SubElement(service, 'meta-data', {a('name'): 'android.accessibilityservice', a('resource'): '@xml/aict_vision'})
manifest.write(TREE / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)

# Apktool preserves these framework resource references but aapt2 requires the
# explicit private-resource notation. This changes no resource target.
for resource in (TREE / 'res/anim').glob('*.xml'):
    value = resource.read_text(encoding='utf-8')
    if '@android:interpolator/transient_interpolator' in value:
        resource.write_text(value.replace('@android:interpolator/transient_interpolator', '@*android:interpolator/transient_interpolator'), encoding='utf-8')

# The upstream builder normally adds native libraries from its host APK.
with zipfile.ZipFile(ROOT / '.tools/autojs6-runtime-source.apk') as host_apk:
    for entry in host_apk.infolist():
        if entry.filename.startswith('lib/arm64-v8a/') and not entry.is_dir():
            destination = TREE / entry.filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(host_apk.read(entry))

vision = ET.Element('accessibility-service', {
    a('accessibilityEventTypes'): 'typeAllMask', a('accessibilityFeedbackType'): 'feedbackGeneric',
    a('accessibilityFlags'): 'flagReportViewIds|flagRetrieveInteractiveWindows|flagIncludeNotImportantViews',
    a('canRetrieveWindowContent'): 'true', a('canPerformGestures'): 'true',
    a('canTakeScreenshot'): 'true', a('notificationTimeout'): '100',
    a('description'): '@string/aict_vision_description'})
ET.ElementTree(vision).write(TREE / 'res/xml/aict_vision.xml', encoding='utf-8', xml_declaration=True)
resources = ET.Element('resources')
ET.SubElement(resources, 'string', {'name': 'aict_vision_description'}).text = '允许可信网页和服务端读取界面节点、获取截图和操作手机。可随时关闭。'
ET.ElementTree(resources).write(TREE / 'res/values/aict.xml', encoding='utf-8', xml_declaration=True)

assets = TREE / 'assets'
shutil.copy(ROOT / 'client/assets/connection.json', assets / 'connection.json')
shutil.copy(ROOT / 'server/web/phone.js', assets / 'phone.js')
project = assets / 'project'
project.mkdir(exist_ok=True)
(project / 'project.json').write_text(json.dumps({'name': 'AIct', 'packageName': 'org.autojs.autojs6.inrt',
    'main': 'main.js', 'versionName': '0.4.1', 'versionCode': 5, 'assets': [],
    'launchConfig': {'hideLogs': True}}), encoding='utf-8')
(project / 'main.js').write_text('// Business scripts are supplied remotely.\n', encoding='utf-8')
print('Prepared independent runtime overlay; credential contents not logged.')
