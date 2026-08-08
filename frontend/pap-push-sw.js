/* PAP 웹 푸시 서비스워커 (B-7, 2026-08-09)
   push → 알림 표시, 클릭 → 계측 링크(ig-out?src=push) 열기 */
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'PAP MAGAZINE', {
    body: data.body || '새 소식이 있습니다',
    icon: '/pap-logo.png',
    badge: '/pap-logo.png',
    data: { url: data.url || 'https://www.pap-magazine.com/' },
  }));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'https://www.pap-magazine.com/';
  event.waitUntil(clients.openWindow(url));
});
