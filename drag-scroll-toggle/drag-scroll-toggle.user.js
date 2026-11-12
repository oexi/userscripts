// ==UserScript==
// @name         Drag Scroll Toggle
// @name:zh-CN   滚动条拖动开关
// @namespace    https://github.com/oexi/userscripts
// @version      2.1.1
// @author       oexi
// @license      AGPL-3.0-or-later
// @description  Adds a small translucent toggle next to the page scrollbar. Click it, then move the mouse up/down to scroll: the farther from the toggle, the faster; holding still keeps a constant speed. Click anywhere (or the toggle again) to stop.
// @description:zh-CN  在页面滚动条旁加一个半透明开关。点一下后上下移动鼠标即可滚动：离开关越远越快，鼠标停住时匀速滚动。点页面任意处或再点开关即关闭。
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3QgeD0iMTgiIHk9IjQiIHdpZHRoPSIyOCIgaGVpZ2h0PSI1NiIgcng9IjE0IiBmaWxsPSIjMEE4NEZGIi8+PHBhdGggZD0iTTI0IDI0bDgtOCA4IDhNMjQgNDBsOCA4IDgtOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg==
// @homepageURL  https://github.com/oexi/userscripts
// @supportURL   https://github.com/oexi/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/oexi/userscripts/main/drag-scroll-toggle/drag-scroll-toggle.user.js
// @updateURL    https://raw.githubusercontent.com/oexi/userscripts/main/drag-scroll-toggle/drag-scroll-toggle.user.js
// @match        *://*/*
// @match        file:///*
// @noframes
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Copyright (C) 2026 oexi
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of
 * the GNU Affero General Public License as published by the Free Software Foundation, either
 * version 3 of the License, or (at your option) any later version. See the LICENSE file.
 */

/*
 * 用法
 *   1. 页面可以滚动时，右侧滚动条旁会出现一个半透明的小开关（上下两个箭头）。
 *   2. 点一下开关进入滚动模式，开关变蓝。
 *   3. 鼠标往开关下方移 → 页面往下滚；往上方移 → 往上滚。
 *      速度只取决于鼠标与开关的上下距离：离得越远越快，停住不动就匀速滚；回到开关高度就停。
 *   4. 点页面任意处、再点一次开关、或按 Esc 退出。退出用的那次点击不会传给页面（不会误点链接）。
 */

(() => {
  'use strict';

  /* =============================== 配置 =============================== */
  const CONFIG = {
    // 开关上下多少像素内不滚动（防手抖）
    deadZone: 10,
    // 速度（px/秒）= speedFactor × (距离 − deadZone) ^ speedExponent
    // 默认值大约是：偏离 50px ≈ 200px/s，100px ≈ 680px/s，200px ≈ 2100px/s
    speedFactor: 0.8,
    speedExponent: 1.5,
    maxSpeed: 8000,
    // true：鼠标往下时页面往上滚
    invert: false,
    // 开关的垂直位置（占滚动区可见高度的比例，0.5 = 正中，上下行程一样长）
    buttonTop: 0.5,
    // 按下到松开的位移小于这个值才算「点击」（px）；超过算拖动，不会关闭
    clickTolerance: 6,
  };

  /* =============================== 状态 =============================== */
  const now = () => performance.now();

  let host = null;        // 挂在 <html> 下的自定义元素，内部是 closed shadow root
  let btn = null;         // 开关
  let overlay = null;     // 开启后铺满页面的透明层：统一光标、挡住页面的悬停和点击
  let on = false;
  let press = null;       // 当前一次由脚本接管的按键 { x, y, opening }
  let swallowUntil = 0;   // 松开后一小段时间内的 mouseup / click / contextmenu 也要吞掉

  let anchorY = 0;
  let curY = 0;
  let scroller = null;
  let rafId = 0;
  let lastFrame = 0;
  let carry = 0;          // 不足 1px 的滚动量累积
  let lastDir = 0;

  /** 阻止默认行为，并且不让页面脚本看到这个事件 */
  function swallow(e) {
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }

  /* ============================== 外观 ============================== */
  const CSS = `
    :host {
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483647 !important;
      display: block !important;
    }
    .btn {
      position: fixed;
      right: 3px;
      top: calc(${CONFIG.buttonTop * 100}% - 22px);
      z-index: 2;
      width: 20px;
      height: 44px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border-radius: 10px;
      color: rgba(255, 255, 255, 0.92);
      background: rgba(28, 28, 30, 0.4);
      -webkit-backdrop-filter: blur(8px) saturate(160%);
      backdrop-filter: blur(8px) saturate(160%);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 1px 3px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: auto;
      transition: background-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
    }
    .btn:hover {
      color: #fff;
      background: rgba(28, 28, 30, 0.62);
    }
    .btn.on {
      color: #fff;
      background: rgba(10, 132, 255, 0.85);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3), 0 2px 10px rgba(10, 132, 255, 0.4);
    }
    .btn.hidden { display: none; }
    .btn svg {
      display: block;
      width: 10px;
      height: 10px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .btn.on svg { opacity: 0.45; }
    .btn.on.up .up,
    .btn.on.down .down {
      opacity: 1;
      transform: scale(1.25);
    }
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1;
      display: none;
      background: transparent;
      cursor: ns-resize;
      pointer-events: auto;
    }
    .overlay.show { display: block; }
    .overlay.up { cursor: n-resize; }
    .overlay.down { cursor: s-resize; }
    @media print {
      :host { display: none !important; }
    }
  `;

  /** 优先用 adoptedStyleSheets（不受页面 CSP 的 style-src 限制），不支持时退回 <style> */
  function applyCss(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // 继续走 <style>
    }
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
  }

  function chevron(cls, d) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 10 10');
    svg.setAttribute('class', cls);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function buildUI() {
    host = document.createElement('drag-scroll-toggle');
    const root = host.attachShadow({ mode: 'closed' });
    applyCss(root);

    overlay = document.createElement('div');
    overlay.className = 'overlay';

    btn = document.createElement('div');
    btn.className = 'btn hidden';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', '拖动滚动');
    btn.appendChild(chevron('up', 'M2 6.5 5 3.5 8 6.5'));
    btn.appendChild(chevron('down', 'M2 3.5 5 6.5 8 3.5'));
    setTitle();

    root.append(overlay, btn);
  }

  function setTitle() {
    btn.title = on ? '移动鼠标滚动 · 点击任意处或按 Esc 退出' : '拖动滚动：点击开启';
  }

  function ensureHost() {
    const html = document.documentElement;
    if (!(html instanceof HTMLElement)) return false; // SVG / XML 文档不处理
    if (!host) buildUI();
    if (!host.isConnected || host.parentNode !== html) html.appendChild(host);
    return true;
  }

  /* ============================ 滚动目标 ============================ */
  const rootEl = () => document.scrollingElement || document.documentElement;

  function isScrollableOverflow(v) {
    return v === 'auto' || v === 'scroll' || v === 'overlay';
  }

  function canScrollY(el) {
    return el.scrollHeight > el.clientHeight + 1 && isScrollableOverflow(getComputedStyle(el).overflowY);
  }

  /** 整页（视口）能不能滚：内容超出，且没有被 overflow: hidden 锁住 */
  function rootScrollable() {
    const se = rootEl();
    if (se.scrollHeight <= se.clientHeight + 1) return false;
    const html = document.documentElement;
    const body = document.body;
    const hs = getComputedStyle(html).overflowY;
    if (hs === 'hidden' || hs === 'clip') return false;
    // <html> 为 visible 时，<body> 的 overflow 会传给视口
    if (hs === 'visible' && body) {
      const bs = getComputedStyle(body).overflowY;
      if (bs === 'hidden' || bs === 'clip') return false;
    }
    return true;
  }

  /**
   * 找页面的「主滚动区」：整页能滚就用整页；
   * 否则从窗口中部几个点往上找可滚动的祖先，取面积最大的那个（应对整页锁死、内容放在内部容器里的单页应用）。
   */
  function findMainScroller() {
    if (rootScrollable()) return rootEl();
    const W = innerWidth;
    const H = innerHeight;
    const seen = new Set();
    let best = null;
    let bestArea = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]]) {
      for (let el = document.elementFromPoint(W * fx, H * fy); el && !seen.has(el); el = el.parentElement) {
        seen.add(el);
        if (el === host || el === document.documentElement) continue;
        if (canScrollY(el)) {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea) {
            best = el;
            bestArea = area;
          }
        }
      }
    }
    return best;
  }

  function scrollStep(px) {
    if (!scroller || !scroller.isConnected) scroller = findMainScroller() || rootEl();
    try {
      // 'instant' 绕开页面的 scroll-behavior: smooth，否则每帧都会叠一段平滑动画
      scroller.scrollBy({ top: px, left: 0, behavior: 'instant' });
    } catch {
      scroller.scrollTop += px;
    }
  }

  /**
   * 把开关放到主滚动区的滚动条左侧：整页滚动时贴着窗口右边，
   * 内部容器滚动时贴着那个容器的滚动条，竖直方向按 buttonTop 落在容器可见范围内。
   */
  function placeButton(el) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let right = 3;
    let top = 0;
    let bottom = vh;
    if (el !== rootEl()) {
      const r = el.getBoundingClientRect();
      const barLeft = r.left + el.clientLeft + el.clientWidth;
      right = Math.max(3, Math.round(vw - barLeft + 3));
      top = Math.max(r.top, 0);
      bottom = Math.min(r.bottom, vh);
    }
    const center = Math.min(Math.max(top + (bottom - top) * CONFIG.buttonTop, 30), vh - 30);
    btn.style.setProperty('right', `${right}px`);
    btn.style.setProperty('top', `${Math.round(center - 22)}px`);
  }

  /** 页面能滚才显示开关 */
  function refresh() {
    if (on || document.hidden || !ensureHost()) return;
    const target = findMainScroller();
    btn.classList.toggle('hidden', !target);
    if (target) placeButton(target);
  }

  /* ============================ 速度与动画 ============================ */
  /** 由鼠标相对开关的纵向偏移算出滚动速度（px/秒，正数向下） */
  function velocity(offset) {
    const dist = Math.abs(offset) - CONFIG.deadZone;
    if (dist <= 0) return 0;
    const speed = Math.min(CONFIG.maxSpeed, CONFIG.speedFactor * Math.pow(dist, CONFIG.speedExponent));
    return Math.sign(offset) * speed * (CONFIG.invert ? -1 : 1);
  }

  function setDir(dir) {
    for (const el of [btn, overlay]) {
      el.classList.toggle('up', dir < 0);
      el.classList.toggle('down', dir > 0);
    }
  }

  function tick(t) {
    if (!on) return;
    // 限制单帧时长：页面卡顿后不至于一下跳太远，低帧率时也不会明显变慢
    const dt = Math.min(0.1, Math.max(0, (t - lastFrame) / 1000));
    lastFrame = t;

    const v = velocity(curY - anchorY);
    const dir = Math.sign(v);
    if (dir !== lastDir) {
      lastDir = dir;
      setDir(dir);
    }
    if (v) {
      carry += v * dt;
      const px = Math.trunc(carry);
      if (px) {
        carry -= px;
        scrollStep(px);
      }
    } else {
      carry = 0;
    }
    rafId = requestAnimationFrame(tick);
  }

  /* ============================== 开关 ============================== */
  function onWheel(e) {
    // 开启时鼠标下是透明层，滚轮默认只会滚整页；主滚动区是内部容器时转给它
    if (!scroller || scroller === rootEl() || e.ctrlKey) return;
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1;
    e.preventDefault();
    scroller.scrollBy({ top: e.deltaY * unit, left: e.deltaX * unit, behavior: 'instant' });
  }

  function setMode(value, y) {
    if (value === on || !btn) return;
    on = value;
    if (on) {
      scroller = findMainScroller() || rootEl();
      // 以点击位置为起点：刚点开时一定在死区内，不会立刻滚
      anchorY = curY = y;
      carry = 0;
      lastDir = 0;
      lastFrame = now();
      setDir(0);
      btn.classList.add('on');
      overlay.classList.add('show');
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
      rafId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
      scroller = null;
      setDir(0);
      btn.classList.remove('on');
      overlay.classList.remove('show');
      window.removeEventListener('wheel', onWheel, { capture: true });
    }
    setTitle();
  }

  /* ============================== 事件 ============================== */
  // 用 pointer 事件判断点击：有些页面会在 pointerdown 上 preventDefault，
  // 那样浏览器就不再派发兼容的 mouse 事件了。

  function onPointerDown(e) {
    if (e.pointerType === 'touch') return;
    if (!on) {
      // closed shadow root 里的元素对外都显示为 host；未开启时没有透明层，点中 host 就是点中开关
      if (!host || e.target !== host) {
        swallowUntil = 0; // 刚关闭后马上点页面，这次点击要正常交给页面
        return;
      }
      swallow(e);
      if (e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY, opening: true };
      setMode(true, e.clientY);
      return;
    }
    // 已开启：任何按键都由脚本接管，不交给页面
    swallow(e);
    press = { x: e.clientX, y: e.clientY, opening: false };
  }

  function onPointerMove(e) {
    if (!on || e.pointerType === 'touch') return;
    curY = e.clientY;
    e.stopImmediatePropagation();
  }

  function onPointerUp(e) {
    if (!press || e.pointerType === 'touch') return;
    swallow(e);
    const p = press;
    press = null;
    swallowUntil = now() + 400;
    // 打开开关的那次点击，松开时不能又把它关掉；按住拖动后松开也不关
    if (p.opening) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < CONFIG.clickTolerance) setMode(false);
  }

  /** mousedown / mouseup / click / contextmenu 等：开启期间及刚松开时一律不交给页面 */
  function onMouseLike(e) {
    if (on || press || now() < swallowUntil) swallow(e);
  }

  function onKeyDown(e) {
    if (on && e.key === 'Escape') {
      swallow(e);
      setMode(false);
    }
  }

  function reset() {
    press = null;
    setMode(false);
  }

  const opts = { capture: true, passive: false };
  const listen = (type, fn) => window.addEventListener(type, fn, opts);
  listen('pointerdown', onPointerDown);
  listen('pointermove', onPointerMove);
  listen('pointerup', onPointerUp);
  listen('pointercancel', (e) => {
    if (e.pointerType !== 'touch') press = null;
  });
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'selectstart', 'dragstart']) {
    listen(type, onMouseLike);
  }
  listen('mousemove', (e) => {
    if (on) e.stopImmediatePropagation();
  });
  listen('keydown', onKeyDown);
  // capture 阶段的 window 也会收到页面里元素的 blur，只认窗口自身失焦
  listen('blur', (e) => {
    if (e.target === window) reset();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
    else refresh();
  }, true);

  // 页面内容会变（异步加载、单页应用切换），定期检查要不要显示开关
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 200);
  });
  window.addEventListener('load', refresh);
  const start = () => {
    refresh();
    setInterval(refresh, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
