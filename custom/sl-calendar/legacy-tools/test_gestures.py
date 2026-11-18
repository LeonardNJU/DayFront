from playwright.sync_api import sync_playwright
from pathlib import Path
import time
P=Path("/home/lsamc/work/leo-dayfront-mobile")
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for width,height in [(390,844),(320,640),(1280,850)]:
  ctx=b.new_context(viewport={'width':width,'height':height},bypass_csp=True,has_touch=width<500,device_scale_factor=2 if width<500 else 1)
  page=ctx.new_page()
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)[:200]))
  page.route('**/assets/index-BKTNy5vj.js',lambda route:route.fulfill(path=str(P/'frontend-calendar-v2.js'),content_type='application/javascript'))
  page.goto('http://127.0.0.1:18885/',wait_until='networkidle')
  page.add_style_tag(path=str(P/'sl-mobile.css'))
  page.add_script_tag(path=str(P/'leo-theme.js'))
  page.add_script_tag(path=str(P/'sl-mobile.js'))
  page.wait_for_timeout(750)
  print('BASE',width,page.evaluate('''() => ({bridge:!!window.slMobileCalendar,view:window.slMobileCalendar?.calendar?.view?.type,active:document.body.className,board:document.querySelector('#slm-dualday')?.getBoundingClientRect().toJSON(),columns:document.querySelectorAll('.slm-day-lane').length,ticks:document.querySelectorAll('.slm-hour-tick').length,events:document.querySelectorAll('.slm-day-event').length,overflow:document.documentElement.scrollWidth-innerWidth,calendar:document.querySelector('.fc-toolbar-title')?.innerText})'''),'ERR',errors[:4])
  if width<500:
   board=page.locator('#slm-dualday .slm-day-columns')
   bbox=board.bounding_box()
   def pt(half,position):
    return (bbox['x']+bbox['width']*(.25 if half==0 else .75),bbox['y']+bbox['height']*position)
   orig=page.locator('#slm-current-date').inner_text()
   # avoid clicking event chips by navigating on time label area
   x,y=pt(0,.4)
   page.mouse.move(x,y)
   page.mouse.down()
   page.mouse.move(x-80,y,steps=6)
   page.mouse.up()
   page.wait_for_timeout(200)
   later=page.locator('#slm-current-date').inner_text()
   print('SWIPE',orig,later,'changed',orig!=later)
   # long-press drag 09:00-10:00 in first column
   a=pt(0,.76);z=pt(0,.85)
   page.mouse.move(*a);page.mouse.down();page.wait_for_timeout(500);page.mouse.move(*z,steps=8);page.mouse.up()
   print('LONGPRESS',page.locator('.dialog-backdrop h2').all_inner_texts(),page.locator('.dialog-backdrop input').evaluate_all('els=>els.map(e=>({type:e.type,value:e.value,aria:e.getAttribute("aria-label")})).slice(0,8)'))
   if page.locator('.dialog-backdrop').count():page.locator('.dialog-backdrop button[aria-label="Close"]').first.click(timeout=3000)
   # double tap in second column
   a=pt(1,.69)
   page.mouse.click(*a,delay=70);page.wait_for_timeout(120);page.mouse.click(*a,delay=70)
   print('DOUBLETAP',page.locator('.dialog-backdrop h2').all_inner_texts(),page.locator('.dialog-backdrop input').evaluate_all('els=>els.map(e=>({type:e.type,value:e.value,aria:e.getAttribute("aria-label")})).slice(0,7)'))
   if page.locator('.dialog-backdrop').count():page.locator('.dialog-backdrop button[aria-label="Close"]').first.click(timeout=3000)
   page.locator('#slm-view').click()
   print('VIEWS',page.locator('#slm-views button').all_inner_texts())
   page.locator('#slm-views [data-view="timeGridThreeDay"]').click()
   print('THREEDAY',page.evaluate("({view:window.slMobileCalendar?.calendar?.view?.type,label:document.querySelector('#slm-view-name')?.textContent,store:localStorage.getItem('sl-mobile-view')})"))
   page.locator('#slm-view').click()
   page.locator('#slm-views [data-view="timeGridDay"]').click()
   page.screenshot(path=str(P/f'preview-{width}.png'))
  else:
   print('DESKTOP',page.locator('.fc-timeGridFourDay-button').count(),page.locator('.fc-timeGridThreeDay-button').count(),page.locator('#slm-shell').count(),page.evaluate("document.body.classList.contains('slm-active')"))
  print('ERRORS',errors[:5])
  ctx.close()
 b.close()
