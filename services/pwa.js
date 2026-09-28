/* ============================================================
 * services/pwa.js — مسؤول عن تسجيل عامل الخدمة (sw.js) فقط، حتى تفتح صفحات الموقع
 * ومكتباته من نسخة محفوظة بالجهاز عند انقطاع الإنترنت. مع الإنترنت تبقى الصفحات تُجلب
 * من الشبكة أولًا كما هي، فلا يتغيّر شيء على المستخدم المتصل.
 *
 * Registers the service worker (sw.js) only, so the site's pages and libraries open
 * from an on-device copy when the internet is down. Online, pages are still fetched
 * from the network first, so nothing changes for a connected user.
 * ============================================================ */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return; // متصفح قديم: الموقع يعمل كما كان بدون وضع الانقطاع / old browser: site works as before, without offline mode
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('تعذّر تسجيل عامل الخدمة / service worker registration failed:', err);
    });
  });
})();
