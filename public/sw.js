/* Solibee 서비스 워커 — 웹 푸시 알림만 담당한다 (fetch 핸들러 없음 = 캐시하지 않음).
 * 규칙(safeHref·알림 옵션·클릭 이동 주소)은 components/notifications/push-client.ts와 같다. 바꾸면 둘 다 바꿀 것.
 * 프로젝트가 정해진 알림은 알림 화면 진입점(/notifications?go=…&project=…)을 열어, 화면이 프로젝트를 바꾼 뒤 이동한다. */
"use strict";

var PUSH_ICON = "/icons/icon-192.png";
var PUSH_BADGE = "/icons/icon-192.png";
var PUSH_ENTRY_PATH = "/notifications";

function safeHref(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (value.charAt(0) !== "/" || value.indexOf("//") === 0 || value.indexOf("/\\") === 0) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  return value;
}

function safeProjectId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[\w-]+$/.test(value) ? value : null;
}

function toNotice(raw) {
  var p = {};
  try {
    var v = raw ? JSON.parse(raw) : {};
    if (v && typeof v === "object") p = v;
  } catch (e) {
    p = {};
  }
  var title = typeof p.title === "string" && p.title.trim() ? p.title : "Solibee 알림";
  var options = {
    icon: PUSH_ICON,
    badge: PUSH_BADGE,
    data: { href: safeHref(p.href), projectId: safeProjectId(p.projectId), id: typeof p.id === "string" && p.id.length <= 64 ? p.id : null },
  };
  if (typeof p.body === "string" && p.body) options.body = p.body;
  if (typeof p.tag === "string" && p.tag) options.tag = p.tag;
  return { title: title, options: options };
}

function safeNotificationId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[\w-]+$/.test(value) ? value : null;
}

// 알림 id가 있거나 프로젝트가 정해진 알림은 알림 화면 진입점으로 — 화면이 읽음 처리·프로젝트 전환 뒤 이동
function clickTarget(data) {
  var href = safeHref(data && data.href);
  var projectId = href ? safeProjectId(data && data.projectId) : null;
  var id = safeNotificationId(data && data.id);
  if (!id && !projectId) return href || PUSH_ENTRY_PATH;
  var q = new URLSearchParams();
  if (id) q.set("read", id);
  if (href) q.set("go", href);
  if (projectId) q.set("project", projectId);
  return PUSH_ENTRY_PATH + "?" + q.toString();
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var raw = null;
  try {
    raw = event.data ? event.data.text() : null;
  } catch (e) {
    raw = null;
  }
  var n = toNotice(raw);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = new URL(clickTarget(event.notification.data), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      var origin = self.location.origin;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).origin !== origin) continue;
        return c.focus().then(function (w) {
          var target = w || c;
          return target.navigate ? target.navigate(url) : self.clients.openWindow(url);
        }).catch(function () {
          return self.clients.openWindow(url);
        });
      }
      return self.clients.openWindow(url);
    })
  );
});
