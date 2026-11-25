"""Reproduce the Snap Links CSP lasso bug in a real Firefox via geckodriver.

usage: repro.py <name> <extension_dir> <scenario,...>
scenarios: plain (local page, no CSP), csp (same page with style-src 'self'), manga (mangaupdates.com)
"""
import json, os, sys, threading, time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from functools import partial

from selenium import webdriver
from selenium.webdriver.common.actions.action_builder import ActionBuilder
from selenium.webdriver.common.actions.mouse_button import MouseButton
from selenium.webdriver.common.actions.pointer_input import PointerInput
from selenium.webdriver.common.actions import interaction
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots')
TESTDIR = r'V:\SnapLinksPlus\test'
os.makedirs(SHOTS, exist_ok=True)

name, ext_dir, scenarios = sys.argv[1], sys.argv[2], sys.argv[3].split(',')


POLICIES = {
	'csp':    "style-src 'self'",
	'tt':     "require-trusted-types-for 'script'",
	'strict': "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; require-trusted-types-for 'script'; trusted-types 'none'",
}


class Handler(SimpleHTTPRequestHandler):
	def end_headers(self):
		pre = self.path.split('/')[1]
		if pre in POLICIES:
			self.send_header('Content-Security-Policy', POLICIES[pre])
		super().end_headers()

	def translate_path(self, path):
		pre = path.split('/')[1]
		return super().translate_path(path[len(pre) + 1:] if pre in POLICIES else path)

	def log_message(self, *a):
		pass


server = HTTPServer(('127.0.0.1', 0), partial(Handler, directory=TESTDIR))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'

URLS = {
	'plain': base + '/test_links.html',
	'csp':   base + '/csp/test_links.html',
	'tt':     base + '/tt/test_links.html',
	'strict': base + '/strict/test_links.html',
	'fixture': base + '/csp_style.html',
	'manga': 'https://www.mangaupdates.com/site/search/result?search=necromancer',
	'aw':    'https://arewewaylandyet.com/',
	'fresh': 'https://demo.freshrss.org/i/',
	'yt':    'https://www.youtube.com/results?search_query=necromancer',
}

STATE_JS = r'''
const c = document.querySelector('.SnapLinksContainer');
const styles = [...document.querySelectorAll('style')].filter(s => s.textContent.includes('SnapLinksContainer'))
	.map(s => { try { return { rules: s.sheet ? s.sheet.cssRules.length : null }; } catch(e) { return { rules: 'extension-owned' }; } });
if(!c) return { container: false, styles };
const r = c.querySelector('.SL_SelectionRect'), l = c.querySelector('.SL_SelectionLabel'), svg = c.querySelector('svg');
const box = e => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
const rs = getComputedStyle(r);
const act = svg && svg.querySelector('rect.ActOn');
return {
	container: true, styles,
	containerPosition: getComputedStyle(c).position, containerZ: getComputedStyle(c).zIndex,
	rect: { box: box(r), position: rs.position, outline: rs.outlineStyle + ' ' + rs.outlineWidth + ' ' + rs.outlineColor },
	label: { text: l.textContent, box: box(l), position: getComputedStyle(l).position },
	svg: svg && { box: box(svg), position: getComputedStyle(svg).position },
	actOn: svg ? svg.querySelectorAll('rect.ActOn').length : 0,
	firstActOn: act && { styleAttr: act.getAttribute('style'), fill: getComputedStyle(act).fill, stroke: getComputedStyle(act).stroke },
};
'''

PAGE_CSSOM_JS = r'''
const a = document.createElement('div'), b = document.createElement('div');
a.setAttribute('style', 'position: absolute'); b.style.cssText = 'position: absolute';
document.body.append(a, b);
const r = { setAttribute: getComputedStyle(a).position, cssText: getComputedStyle(b).position };
a.remove(); b.remove();
return r;
'''

PICK_JS = r'''
const vis = [...document.querySelectorAll('a[href]')].map(a => [a, a.getBoundingClientRect()])
	.filter(([a, b]) => b.width > 20 && b.height > 5 && b.top > 60 && b.bottom < innerHeight - 40 && b.left > 30 && b.right < innerWidth - 30);
if(!vis.length) return null;
const [a0, b0] = vis[0];
return [Math.round(b0.left - 15), Math.round(b0.top - 8), Math.min(innerWidth - 20, Math.round(b0.right + 250)), Math.min(innerHeight - 20, Math.round(b0.top + 220))];
'''


def drag(driver, x0, y0, x1, y1):
	mouse = PointerInput(interaction.POINTER_MOUSE, 'mouse')
	ab = ActionBuilder(driver, mouse=mouse)
	ab.pointer_action.move_to_location(x0, y0)
	ab.pointer_action.pointer_down(MouseButton.RIGHT)
	for i in range(1, 13):
		ab.pointer_action.move_to_location(int(x0 + (x1 - x0) * i / 12), int(y0 + (y1 - y0) * i / 12))
		ab.pointer_action.pause(0.06)
	ab.pointer_action.pause(0.4)
	ab.perform()


def release(driver):
	ActionChains(driver).send_keys(Keys.ESCAPE).perform()
	mouse = PointerInput(interaction.POINTER_MOUSE, 'mouse')
	ab = ActionBuilder(driver, mouse=mouse)
	ab.pointer_action.pointer_up(MouseButton.RIGHT)
	ab.perform()
	time.sleep(0.3)
	ActionChains(driver).send_keys(Keys.ESCAPE).perform()


opts = webdriver.FirefoxOptions()
opts.binary_location = r'C:\Program Files\Mozilla Firefox\firefox.exe'
opts.set_preference('browser.shell.checkDefaultBrowser', False)
opts.set_preference('media.volume_scale', '0.0')
driver = webdriver.Firefox(options=opts)
try:
	driver.set_window_size(1280, 900)
	main = driver.current_window_handle
	driver.install_addon(ext_dir, temporary=True)
	time.sleep(2.5)
	for h in driver.window_handles:
		if h != main:
			driver.switch_to.window(h)
			driver.close()
	driver.switch_to.window(main)

	results = {}
	for sc in scenarios:
		driver.get(URLS[sc])
		for _ in range(40):
			if driver.execute_script('return document.readyState') == 'complete':
				break
			time.sleep(0.25)
		time.sleep(2 if sc == 'manga' else 0.7)
		pick = driver.execute_script(PICK_JS)
		if not pick:
			results[sc] = 'no visible links'
			continue
		drag(driver, *pick)
		time.sleep(0.5)
		state = driver.execute_script(STATE_JS)
		state['drag'] = pick
		state['pageCSSOM'] = driver.execute_script(PAGE_CSSOM_JS)
		state['csp'] = driver.execute_script("const m = document.querySelector('meta[http-equiv=\"Content-Security-Policy\" i]'); return m && m.content")
		shot = os.path.join(SHOTS, f'{name}-{sc}.png')
		driver.save_screenshot(shot)
		release(driver)
		results[sc] = state
	print(json.dumps({name: results}, indent=1))
finally:
	driver.quit()
	server.shutdown()
