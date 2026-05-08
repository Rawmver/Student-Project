self.addEventListener("push", (event) => {
  let data = { title: "Student Portal", body: "You have a new notification" };
  try {
    data = event.data.json();
  } catch (e) {}

  const options = {
    body: data.body,
    icon: "/favicon.png",
    badge: "/favicon.png",
    vibrate: [200, 100, 200],
    tag: data.tag || "default",
    data: { url: data.url || "/student-portal" },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/student-portal";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
