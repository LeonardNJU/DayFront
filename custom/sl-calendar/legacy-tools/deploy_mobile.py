#!/usr/bin/env python3
"""Deploy SL Calendar mobile UI. Does not change CalDAV routes, API, or user data."""
from pathlib import Path
from shutil import copy2
from subprocess import run
import re
import sys

root=Path("/opt/leo-dayfront")
staged=Path("/tmp/sl-calendar-mobile-release")
conf=Path("/etc/nginx/sites-available/nas-dav")
backup=Path("/opt/backup/sl-calendar-mobile-20261027")
assets=["frontend-calendar-v2.js","leo-theme.js","sl-mobile.js","sl-mobile.css","sl-mobile.webmanifest"]
assert all((staged/f).is_file() for f in assets), "Missing staging assets"
assert conf.is_file()
text=conf.read_text()
assert "location = /sl-mobile.js" not in text, "Mobile UI already deployed, refusing duplicate insert"
assert "sub_filter '</head>'" in text and "/assets/index-leo-ui-v3-20261022.js" in text
backup.mkdir(parents=True,exist_ok=False)
for f in ["frontend-calendar-v2.js","leo-theme.js"]:
    copy2(root/f,backup/f)
copy2(conf,backup/"nas-dav")
try:
    for f in assets:
        copy2(staged/f,root/f)
    locations="""
    # SL Calendar mobile UI files. All existing CalDAV proxy routes are unchanged.
    location = /sl-mobile.js {
        alias /opt/leo-dayfront/sl-mobile.js;
        default_type application/javascript;
        add_header Cache-Control "no-cache";
    }
    location = /sl-mobile.css {
        alias /opt/leo-dayfront/sl-mobile.css;
        default_type text/css;
        add_header Cache-Control "no-cache";
    }
    location = /sl-mobile.webmanifest {
        alias /opt/leo-dayfront/sl-mobile.webmanifest;
        default_type application/manifest+json;
        add_header Cache-Control "no-cache";
    }
"""
    marker="    location = /leo-ui-v3.css {"
    assert text.count(marker)==1
    text=text.replace(marker,locations+"\n"+marker)
    injection=(
      '<link rel="manifest" href="/sl-mobile.webmanifest?v=20261027a">'
      '<meta name="apple-mobile-web-app-capable" content="yes">'
      '<meta name="apple-mobile-web-app-title" content="SL Calendar">'
      '<link rel="stylesheet" href="/sl-mobile.css?v=20261027a">'
      '<script defer src="/sl-mobile.js?v=20261027a"></script>'
    )
    pattern=r"(sub_filter '</head>' ')([^']*?)(\';)"
    found=list(re.finditer(pattern,text))
    assert len(found)==1, len(found)
    f=found[0]
    replacement=f.group(2)
    assert replacement.endswith("</head>"),replacement[-100:]
    patched=replacement[:-len("</head>")]+injection+"</head>"
    text=text[:f.start(2)]+patched+text[f.end(2):]
    conf.write_text(text)
    result=run(["nginx","-t"],capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError("nginx -t failed: "+(result.stderr or result.stdout)[-300:])
    result=run(["systemctl","reload","nginx"],capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError("nginx reload failed: "+(result.stderr or result.stdout)[-300:])
    print("DEPLOYED",str(backup),"nginx valid and reloaded")
except Exception:
    copy2(backup/"nas-dav",conf)
    for f in ["frontend-calendar-v2.js","leo-theme.js"]:
        copy2(backup/f,root/f)
    for f in ["sl-mobile.js","sl-mobile.css","sl-mobile.webmanifest"]:
        (root/f).unlink(missing_ok=True)
    run(["nginx","-t"],capture_output=True)
    run(["systemctl","reload","nginx"],capture_output=True)
    raise
