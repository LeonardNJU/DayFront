from playwright.sync_api import sync_playwright
from pathlib import Path
P=Path('/home/lsamc/work/leo-dayfront-mobile')
with sync_playwright() as p:
 b=p.chromium.launch()
 ctx=b.new_context(viewport={'width':390,'height':844},bypass_csp=True,has_touch=True)
 page=ctx.new_page()
 page.route('**/assets/index-BKTNy5vj.js',lambda r:r.fulfill(path=str(P/'frontend-calendar-v2.js'),content_type='application/javascript'))
 page.goto('http://127.0.0.1:18885/',wait_until='networkidle')
 page.add_style_tag(path=str(P/'sl-mobile.css'));page.add_script_tag(path=str(P/'leo-theme.js'));page.add_script_tag(path=str(P/'sl-mobile.js'))
 page.wait_for_timeout(350)
 box=page.locator('#slm-dualday .slm-day-columns').bounding_box()
 ax=box['x']+box['width']*.25
 y0=box['y']+box['height']*.77
 y1=box['y']+box['height']*.87
 page.mouse.move(ax,y0);page.mouse.down();page.wait_for_timeout(480);page.mouse.move(ax,y1,steps=7);page.mouse.up()
 print('EVENT EDITOR TEXT',page.locator('.dialog-backdrop').inner_text()[:1000])
 print('FORM HTML CONTROLS',page.locator('.dialog-backdrop input,.dialog-backdrop select,.dialog-backdrop button').evaluate_all('es=>es.map(e=>({tag:e.tagName,type:e.type,aria:e.getAttribute("aria-label"),text:e.textContent.trim().slice(0,40),value:e.value,checked:e.checked})).slice(0,34)'))
 print('SCREEN',page.locator('#slm-dualday').is_visible())
 b.close()
