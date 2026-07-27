const indexFilePattern = /(?:^|\/)index\.html$/;

function cleanIndexUrl(url) {
  if (!indexFilePattern.test(url.pathname)) return url.href;
  const cleanUrl = new URL(url.href);
  cleanUrl.pathname = cleanUrl.pathname.replace(/index\.html$/, "");
  return cleanUrl.href;
}

function cleanCurrentUrl() {
  if (window.location.protocol === "file:") return;
  const cleanUrl = cleanIndexUrl(new URL(window.location.href));
  if (cleanUrl !== window.location.href) {
    window.history.replaceState(null, "", cleanUrl);
  }
}

function cleanInternalLinks() {
  if (window.location.protocol === "file:") return;
  document.querySelectorAll("a[href]").forEach((link) => {
    const url = new URL(link.href);
    if (url.origin !== window.location.origin) return;
    link.href = cleanIndexUrl(url);
  });
}

cleanCurrentUrl();
cleanInternalLinks();
