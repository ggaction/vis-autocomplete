"""Canvas paint assertions shared by browser workflows."""
from pathlib import Path

def observe_canvas(page):
    page.add_init_script(path=str(Path(__file__).with_name('canvas-observer.js')))

def canvas_text(page, selector, text, present=True, font_size=None):
    page.wait_for_function('''([selector,text,present,size])=>{
      const canvas=document.querySelector(selector);if(!canvas)return false;
      const found=(canvas.__drawings??[]).some(v=>v.type==='text'&&v.text.includes(text)&&(!size||(' '+v.font).includes(' '+size+'px ')));
      return found===present;
    }''', arg=[selector,text,present,font_size], timeout=30000)
