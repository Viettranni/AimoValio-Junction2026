/*
 * Aimo Planner drop-in widget.
 * <script src="https://<aimo-host>/widget.js" data-customer="your-id" data-position="bottom-right" defer></script>
 * Injects a launcher and an isolated iframe (/embed on this script's own origin) that grows from bubble to panel.
 */
(function () {
  'use strict';
  if (window.__aimoWidget) return;
  window.__aimoWidget = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!script) return;

  var origin = new URL(script.src, location.href).origin;
  var customer = script.getAttribute('data-customer') || '';
  var side = script.getAttribute('data-position') === 'bottom-left' ? 'left' : 'right';
  var demo = new URLSearchParams(location.search).get('demo') === '1';

  var SIZES = {
    chat: ['min(380px, calc(100vw - 32px))', 'min(600px, calc(100vh - 116px))'],
    expanded: ['min(1100px, 92vw)', 'min(86vh, calc(100vh - 116px))'],
  };

  var svg = function (body) {
    return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  var ICON_CHAT = svg('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17a2 2 0 0 1-2-2z"/><path d="M8.5 9h7M8.5 12.5h4.5"/>');
  var ICON_CLOSE = svg('<path d="M6 9l6 6 6-6"/>');

  var style = document.createElement('style');
  style.textContent = [
    '.aimo-launcher{position:fixed;bottom:24px;' + side + ':24px;z-index:2147483000;width:56px;height:56px;border:0;border-radius:50%;',
    'background:#00205B;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;',
    'box-shadow:0 8px 24px rgba(0,32,91,.28),0 2px 6px rgba(0,32,91,.18);',
    'transition:transform .25s cubic-bezier(.2,1.2,.3,1),box-shadow .25s,opacity .3s;animation:aimo-in .45s cubic-bezier(.2,1.2,.3,1) .3s both}',
    '.aimo-launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 12px 28px rgba(0,32,91,.32),0 2px 6px rgba(0,32,91,.18)}',
    '.aimo-launcher:focus-visible{outline:3px solid #0057B8;outline-offset:3px}',
    '.aimo-launcher span{display:flex;transition:transform .3s cubic-bezier(.2,1.2,.3,1)}',
    '.aimo-launcher[aria-expanded="true"] span{transform:rotate(180deg)}',
    '.aimo-frame{position:fixed;bottom:92px;' + side + ':24px;z-index:2147483000;border:0;border-radius:16px;background:#fff;',
    'box-shadow:0 18px 50px rgba(0,32,91,.22),0 2px 8px rgba(0,32,91,.08);transform-origin:bottom ' + side + ';',
    'transition:width .56s cubic-bezier(.2,1.12,.3,1),height .56s cubic-bezier(.2,1.12,.3,1),opacity .22s ease,transform .26s cubic-bezier(.2,1.1,.3,1),visibility 0s}',
    '.aimo-frame[data-open="false"]{opacity:0;transform:translateY(12px) scale(.97);visibility:hidden;pointer-events:none;',
    'transition:opacity .18s ease,transform .2s ease,visibility 0s .2s}',
    '@keyframes aimo-in{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion: reduce){.aimo-launcher,.aimo-launcher span,.aimo-frame,.aimo-frame[data-open="false"]{transition:none;animation:none}}',
  ].join('');
  document.head.appendChild(style);

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'aimo-launcher';
  launcher.setAttribute('aria-label', 'Open the Aimo ordering assistant');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = '<span>' + ICON_CHAT + '</span>';
  document.body.appendChild(launcher);

  var frame = null;
  var open = false;
  var size = 'chat';

  function applySize() {
    frame.style.width = SIZES[size][0];
    frame.style.height = SIZES[size][1];
  }

  function createFrame() {
    var params = new URLSearchParams({ customer: customer, parentOrigin: location.origin });
    if (demo) params.set('demo', '1');
    frame = document.createElement('iframe');
    frame.className = 'aimo-frame';
    frame.title = 'Aimo ordering assistant';
    frame.src = origin + '/embed?' + params.toString();
    frame.setAttribute('data-open', 'false');
    applySize();
    document.body.appendChild(frame);
  }

  function setOpen(next) {
    if (!frame) createFrame();
    open = next;
    // Let the first frame render closed so the opening transition plays.
    requestAnimationFrame(function () {
      frame.setAttribute('data-open', String(open));
    });
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Minimise the Aimo ordering assistant' : 'Open the Aimo ordering assistant');
    launcher.firstChild.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
  }

  launcher.addEventListener('click', function () {
    setOpen(!open);
  });

  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    var data = event.data;
    if (!data || data.type !== 'aimo:resize') return;
    if (data.state === 'closed') return setOpen(false);
    size = data.state === 'expanded' ? 'expanded' : 'chat';
    applySize();
  });
})();
