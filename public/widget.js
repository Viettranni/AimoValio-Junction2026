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
  // Aimo ordering robot, the inverse of /aimo-bot.svg so it reads on the petrol launcher.
  var ICON_CHAT = '<svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true">' +
    '<rect x="30" y="8" width="4" height="9" rx="2" fill="#fff"/><circle cx="32" cy="7" r="5" fill="#C0E021"/>' +
    '<rect x="4" y="29" width="7" height="13" rx="3.5" fill="#C0E021"/><rect x="53" y="29" width="7" height="13" rx="3.5" fill="#C0E021"/>' +
    '<rect x="9" y="15" width="46" height="41" rx="14" fill="#fff"/><rect x="15" y="22" width="34" height="27" rx="9" fill="#005670"/>' +
    '<circle cx="25" cy="33" r="3.75" fill="#fff"/><circle cx="39" cy="33" r="3.75" fill="#fff"/>' +
    '<path d="M26.5 40.5q5.5 4.5 11 0" fill="none" stroke="#C0E021" stroke-width="3" stroke-linecap="round"/></svg>';
  var ICON_CLOSE = svg('<path d="M6 9l6 6 6-6"/>');

  var style = document.createElement('style');
  style.textContent = [
    '.aimo-launcher{position:fixed;bottom:24px;' + side + ':24px;z-index:2147483000;width:56px;height:56px;border:0;border-radius:50%;',
    'background:#005670;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;',
    'box-shadow:0 0 0 2px #C0E021,0 8px 24px rgba(0,61,80,.28),0 2px 6px rgba(0,61,80,.18);',
    'transition:transform .25s cubic-bezier(.2,1.2,.3,1),box-shadow .25s,opacity .3s;animation:aimo-in .45s cubic-bezier(.2,1.2,.3,1) .3s both}',
    '.aimo-launcher:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 0 0 4px #C0E021,0 12px 28px rgba(0,61,80,.32),0 2px 6px rgba(0,61,80,.18)}',
    '.aimo-launcher:focus-visible{outline:3px solid #005670;outline-offset:5px}',
    '.aimo-launcher span{display:flex;transition:transform .3s cubic-bezier(.2,1.2,.3,1)}',
    '.aimo-launcher[aria-expanded="true"] span{transform:rotate(180deg)}',
    '.aimo-frame{position:fixed;bottom:92px;' + side + ':24px;z-index:2147483000;border:0;border-radius:16px;background:#fff;',
    'box-shadow:0 18px 50px rgba(0,61,80,.22),0 2px 8px rgba(0,61,80,.08);transform-origin:bottom ' + side + ';',
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
    // The Connect-Claude card copies its link, and the composer's mic listens, from inside the frame.
    frame.setAttribute('allow', 'clipboard-write; microphone');
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
    // Lets the widget pause its loader animations while minimised.
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'aimo:open', open: open }, origin);
  }

  launcher.addEventListener('click', function () {
    setOpen(!open);
  });

  // Lets the host page open the assistant from its own buttons.
  window.AimoWidget = {
    open: function () {
      if (!open) setOpen(true);
    },
  };

  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    var data = event.data;
    if (!data || data.type !== 'aimo:resize') return;
    if (data.state === 'closed') return setOpen(false);
    size = data.state === 'expanded' ? 'expanded' : 'chat';
    applySize();
  });
})();
