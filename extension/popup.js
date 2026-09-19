document.getElementById("open-web")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "http://localhost:3100" });
});
