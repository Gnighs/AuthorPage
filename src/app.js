const directorySection = document.querySelector("#directory-section");
const directoryGrid = document.querySelector("#section-grid");
const directoryKicker = document.querySelector("#directory-kicker");
const directoryTitle = document.querySelector("#sections-title");
const documentPanel = document.querySelector("#document-panel");
const documentList = document.querySelector("#document-list");
const documentDirectLink = document.querySelector("#document-direct-link");
const documentsTitle = document.querySelector("#documents-title");
const activeSectionKicker = document.querySelector("#active-section-kicker");
const generationStamp = document.querySelector("#generation-stamp");
const statusPanel = document.querySelector("#status-panel");
const summaryButtons = document.querySelectorAll("[data-summary-view]");
const navigationBar = document.querySelector("#navigation-bar");
const breadcrumbs = document.querySelector("#breadcrumbs");
const backButton = document.querySelector("#back-button");

const archiveManifest = window.archiveManifest;
const rootCatalog = archiveManifest.root;
const mobileViewport = window.matchMedia("(max-width: 640px)");
const localFileProtocol = window.location.protocol === "file:";
const archiveBasePath = "oasl9";
const appScriptUrl =
  document.currentScript?.src ||
  Array.from(document.scripts)
    .map((script) => script.src)
    .find((src) => src.endsWith("/src/app.js")) ||
  new URL("/src/app.js", window.location.href).href;
const pdfJsScriptPath = new URL("vendor/pdfjs/pdf.min.js", appScriptUrl).href;
const pdfJsWorkerPath = new URL("vendor/pdfjs/pdf.worker.min.js", appScriptUrl).href;
const maxPdfOutputScale = 2;
const minPdfZoom = 0.5;
const maxPdfZoom = 3;
const pdfZoomStep = 0.1;
const pdfRenderStatusDelay = 1200;
let activeSummaryView = "station";
let activePdfViewerId = 0;
let pdfRenderSequence = 0;
let pdfJsLoadPromise = null;

const stationStatusItems = [
  { label: "Archival Integrity", value: "Moderate" },
  { label: "Clearance", value: "Public-ish" },
  { label: "Interface Language", value: "Senate Standard Shasvin" }
];

const fileStatusItems = [
  { label: "Cleared Files", status: "Cleared", className: "cleared" },
  { label: "In Progress Files", status: "InProgress", className: "in-progress" },
  { label: "Classified Files", status: "Classified", className: "classified" }
];

function rootRoute() {
  return { node: rootCatalog, ancestors: [], path: [], document: null, documentPath: null };
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `Index refreshed ${date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  })}`;
}

function collectDocuments(node) {
  if (node.kind === "index") return node.documents;
  return (node.items ?? []).flatMap(collectDocuments);
}

function formatPercentage(count, total) {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function renderStatusItem({ label, value, detail, className = "" }) {
  const item = document.createElement("div");
  if (className) item.className = className;
  item.innerHTML = `
    <span class="status-label">${label}</span>
    <strong>${value}</strong>
    ${detail ? `<span class="status-detail">${detail}</span>` : ""}
  `;
  return item;
}

function getFileReportItems() {
  const documents = collectDocuments(rootCatalog);
  const total = documents.length;
  return fileStatusItems.map((item) => {
    const count = documents.filter((document) => document.status === item.status).length;
    return {
      label: item.label,
      value: `${formatPercentage(count, total)} (${count}/${total})`,
      className: item.className
    };
  });
}

function renderSummary() {
  Array.from(summaryButtons).forEach((button) => {
    const isActive = button.dataset.summaryView === activeSummaryView;
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  const items = activeSummaryView === "files" ? getFileReportItems() : stationStatusItems;
  statusPanel.replaceChildren(...items.map(renderStatusItem));
}

function normalizeHash(hash) {
  const normalized = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return "";
  }
}

function legacyPath(parts) {
  if (parts[0] === "planetary") return ["colonial-records"];
  if (parts[0] === "planet" && parts[1]) {
    return ["colonial-records", parts[1], ...parts.slice(2)];
  }
  if (parts[0] === "general") return ["general", ...parts.slice(1)];
  return null;
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

function pathParts() {
  if (localFileProtocol) return [];

  const parts = window.location.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map(decodePathSegment)
    .filter(Boolean);

  if (parts[0] === "src" && (!parts[1] || parts[1] === "index.html")) return [];
  if (parts[0] === archiveBasePath) {
    const archiveParts = parts.slice(1);
    return archiveParts[archiveParts.length - 1] === "index.html"
      ? archiveParts.slice(0, -1)
      : archiveParts;
  }
  if (parts[parts.length - 1] === "index.html") return parts.slice(0, -1);
  if (parts[0] === "browse") return parts.slice(1);
  return parts;
}

function resolvePath(path) {
  let node = rootCatalog;
  const ancestors = [];
  const indexPath = [];

  for (const segment of path) {
    if (node.kind === "index") {
      const document = (node.documents ?? []).find((file) => file.id === segment && file.isAvailable);
      return document
        ? { node, ancestors, path: indexPath, document, documentPath: [...indexPath, document.id] }
        : null;
    }
    if (!node.items) return null;
    const next = node.items.find((item) => item.id === segment);
    if (!next || !next.isAccessible) return null;
    ancestors.push(node);
    node = next;
    indexPath.push(segment);
  }

  return { node, ancestors, path: indexPath, document: null, documentPath: null };
}

function getRoute() {
  const hashParts = normalizeHash(window.location.hash).split("/").filter(Boolean);
  const parts = hashParts.length ? hashParts : pathParts();
  if (parts.length === 0) return rootRoute();

  const path = parts[0] === "browse" ? parts.slice(1) : legacyPath(parts) ?? parts;
  const candidate = path ?? [];
  return resolvePath(candidate) ?? rootRoute();
}

function routeUrl(path) {
  const archiveRoot = `/${archiveBasePath}`;
  return path.length
    ? `${archiveRoot}/${path.map(encodeURIComponent).join("/")}`
    : `${archiveRoot}/`;
}

function routeHash(path) {
  return path.length ? path.map(encodeURIComponent).join("/") : "";
}

function syncCleanUrl(route) {
  if (localFileProtocol) return;

  const target = routeUrl(route.documentPath ?? route.path);
  if (window.location.hash || window.location.pathname !== target) {
    window.history.replaceState(null, "", target);
  }
}

function navigate(path) {
  if (localFileProtocol) {
    window.location.hash = routeHash(path);
    return;
  }

  window.history.pushState(null, "", routeUrl(path));
  render();
  if (mobileViewport.matches) scrollActiveViewIntoPlace();
}

function itemStatus(item) {
  if (!item.isAccessible) return item.unavailableMessage;
  if (item.availability === "maintenance") return item.emptyWarning;
  if (item.kind === "index") {
    return `${item.count} file${item.count === 1 ? "" : "s"} indexed`;
  }
  let countLabel = item.countLabel || "entries";
  if (item.count === 1) {
    if (countLabel.endsWith("ies")) countLabel = `${countLabel.slice(0, -3)}y`;
    else if (countLabel.endsWith("xes")) countLabel = countLabel.slice(0, -2);
    else if (countLabel.endsWith("s")) countLabel = countLabel.slice(0, -1);
  }
  return `${item.count} ${countLabel} indexed`;
}

function itemAction(item) {
  if (!item.isAccessible) return "Records Unavailable";
  return item.kind === "index" ? "Open Index" : "Open Directory";
}

function directFileHref(file) {
  if (!localFileProtocol) return file.href || `/${file.path}`;
  const prefix = window.location.pathname.includes("/src/")
    ? "../"
    : window.location.pathname.includes(`/${archiveBasePath}/`)
      ? "../"
      : "./";
  return `${prefix}${file.path}`;
}

function openDocument(file, routePath) {
  navigate([...routePath, file.id]);
}

function plainText(value) {
  const template = document.createElement("template");
  template.innerHTML = value || "";
  return template.content.textContent || "";
}

function createCatalogCard(item, path) {
  const card = document.createElement(item.isAccessible ? "button" : "article");
  card.className = `section-card ${item.className} ${item.availability ?? ""}`.trim();

  if (item.isAccessible) {
    card.type = "button";
    card.addEventListener("click", () => navigate(path));
  } else {
    card.setAttribute("aria-disabled", "true");
  }

  card.innerHTML = `
    <span class="card-topline">
      <span>${item.archiveId}</span>
      <span>${item.kind === "index" ? "INDEX" : "DIRECTORY"}</span>
    </span>
    <strong>${item.title}</strong>
    <span class="card-copy">${item.description}</span>
    <span class="card-status">${itemStatus(item)}</span>
  `;
  return card;
}

function createCatalogRow(item, path) {
  const row = document.createElement(item.isAccessible ? "button" : "article");
  row.className = `catalog-row ${item.className} ${item.availability ?? ""}`.trim();

  if (item.isAccessible) {
    row.type = "button";
    row.addEventListener("click", () => navigate(path));
  } else {
    row.setAttribute("aria-disabled", "true");
  }

  row.innerHTML = `
    <span class="document-id">${item.archiveId}</span>
    <span class="document-main">
      <strong>${item.title}</strong>
      <span>${item.description}</span>
    </span>
    <span class="catalog-status">
      <strong>${itemStatus(item)}</strong>
      <span class="document-action">${itemAction(item)}</span>
    </span>
  `;
  return row;
}

function emptyCatalogNotice(node) {
  const article = document.createElement("article");
  article.className = "maintenance-notice";
  article.innerHTML = `
    <span>${node.emptyWarning ?? "DIRECTORY UNDER MAINTENANCE"}</span>
    <strong>${node.emptyTitle ?? "No public entries are available."}</strong>
    <p>${node.emptyMessage ?? "Index reconstruction is pending curator clearance."}</p>
  `;
  return article;
}

function breadcrumbData(route) {
  const nodes = [rootCatalog, ...route.ancestors.slice(1), route.node];
  const seen = [];
  const crumbs = nodes.map((node, index) => {
    if (index > 0) seen.push(route.path[index - 1]);
    return {
      label: node.title,
      path: index === nodes.length - 1 ? undefined : [...seen]
    };
  });
  if (route.document) {
    crumbs[crumbs.length - 1].path = route.path;
    crumbs.push({ label: route.document.id });
  }
  return crumbs;
}

function renderBreadcrumbs(route) {
  const isHome = route.path.length === 0;
  navigationBar.hidden = isHome;
  if (isHome) {
    breadcrumbs.replaceChildren();
    return;
  }

  backButton.onclick = () => navigate(route.document ? route.path : route.path.slice(0, -1));
  const crumbs = breadcrumbData(route);
  breadcrumbs.replaceChildren(
    ...crumbs.flatMap((crumb, index) => {
      const items = [];
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "breadcrumb-separator";
        separator.textContent = "/";
        separator.setAttribute("aria-hidden", "true");
        items.push(separator);
      }

      if (crumb.path) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = crumb.label;
        button.addEventListener("click", () => navigate(crumb.path));
        items.push(button);
      } else {
        const current = document.createElement("span");
        current.textContent = crumb.label;
        current.setAttribute("aria-current", "page");
        items.push(current);
      }
      return items;
    })
  );
}

function renderDirectory(route) {
  const node = route.node;
  const isCatalog = node.kind !== "index";
  directorySection.hidden = !isCatalog;
  if (!isCatalog) return;

  directoryKicker.textContent = node.kicker || (route.path.length ? "Directory" : "Archive Directory");
  directoryTitle.textContent = node.title;
  directoryGrid.className = `section-grid layout-${node.layout}`;

  if (!node.items.length) {
    directoryGrid.replaceChildren(emptyCatalogNotice(node));
  } else {
    const entries = node.items.map((item) => {
      const path = [...route.path, item.id];
      return node.layout === "list"
        ? createCatalogRow(item, path)
        : createCatalogCard(item, path);
    });
    directoryGrid.replaceChildren(...entries);
  }
}

function documentRow(file, routePath) {
  const row = document.createElement(file.isAvailable ? "button" : "article");
  row.className = `document-row ${file.className} ${file.isAvailable ? "available" : "unavailable"}`;
  if (file.isAvailable) {
    row.type = "button";
    row.addEventListener("click", () => openDocument(file, routePath));
  } else {
    row.setAttribute("aria-disabled", "true");
  }
  row.innerHTML = `
    <span class="document-id">${file.archiveId}</span>
    <span class="document-main">
      <strong>${file.title}</strong>
      <span>${file.statusLabel}</span>
    </span>
    <span class="document-action">${file.actionLabel}</span>
  `;
  return row;
}

function documentCard(file, routePath) {
  const card = document.createElement(file.isAvailable ? "button" : "article");
  card.className = `section-card document-card ${file.className} ${file.isAvailable ? "available" : "unavailable"}`.trim();
  if (file.isAvailable) {
    card.type = "button";
    card.addEventListener("click", () => openDocument(file, routePath));
  } else {
    card.setAttribute("aria-disabled", "true");
  }
  card.innerHTML = `
    <span class="card-topline">
      <span>${file.archiveId}</span>
      <span>FILE</span>
    </span>
    <strong>${file.title}</strong>
    <span class="card-copy">${file.statusLabel}</span>
    <span class="card-status">${file.actionLabel}</span>
  `;
  return card;
}

function documentViewer(file) {
  const article = document.createElement("article");
  article.className = "archive-document-viewer";

  if (localFileProtocol) {
    const frame = document.createElement("iframe");
    frame.className = "archive-pdf-frame";
    frame.src = directFileHref(file);
    frame.title = `${plainText(file.title)} PDF`;
    article.append(frame);
    return article;
  }

  article.setAttribute("aria-busy", "true");

  const status = document.createElement("div");
  status.className = "archive-pdf-status";
  status.textContent = "Loading PDF";

  const toolbar = document.createElement("div");
  toolbar.className = "archive-pdf-toolbar";

  const pageControls = document.createElement("div");
  pageControls.className = "archive-pdf-page-controls";

  const previousPage = document.createElement("button");
  previousPage.type = "button";
  previousPage.className = "archive-pdf-control";
  previousPage.textContent = "<";
  previousPage.setAttribute("aria-label", "Previous page");

  const pageLabel = document.createElement("span");
  pageLabel.className = "archive-pdf-page-label";
  pageLabel.setAttribute("aria-live", "polite");
  pageLabel.textContent = "Page 1 / 1";

  const nextPage = document.createElement("button");
  nextPage.type = "button";
  nextPage.className = "archive-pdf-control";
  nextPage.textContent = ">";
  nextPage.setAttribute("aria-label", "Next page");

  pageControls.append(previousPage, pageLabel, nextPage);

  const zoomControls = document.createElement("div");
  zoomControls.className = "archive-pdf-zoom-controls";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "archive-pdf-control";
  zoomOut.textContent = "-";
  zoomOut.setAttribute("aria-label", "Zoom out");

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "archive-pdf-zoom-label";
  zoomLabel.setAttribute("aria-live", "polite");
  zoomLabel.textContent = "100%";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "archive-pdf-control";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");

  zoomControls.append(zoomOut, zoomLabel, zoomIn);

  const openPdfLink = document.createElement("a");
  openPdfLink.className = "archive-pdf-open-link";
  openPdfLink.href = directFileHref(file);
  openPdfLink.target = "_blank";
  openPdfLink.rel = "noopener";
  openPdfLink.textContent = "Open PDF";

  toolbar.append(pageControls, zoomControls, openPdfLink);

  const pages = document.createElement("div");
  pages.className = "archive-pdf-pages";
  pages.setAttribute("aria-label", `${plainText(file.title)} PDF`);

  const viewport = document.createElement("div");
  viewport.className = "archive-pdf-viewport";
  viewport.append(pages);

  article.append(toolbar, status, viewport);
  renderPdfViewer(file, article, pages, status, {
    previousPage,
    pageLabel,
    nextPage,
    zoomOut,
    zoomIn,
    zoomLabel,
    viewport
  });
  return article;
}

function pdfViewerIsActive(viewerId, article) {
  return viewerId === activePdfViewerId && article.isConnected;
}

function replaceDocumentList(...children) {
  documentList.replaceChildren(...children);
}

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsLoadPromise) return pdfJsLoadPromise;

  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = pdfJsScriptPath;
    script.async = true;
    script.onload = () => {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("PDF.js loaded without exposing pdfjsLib."));
      }
    };
    script.onerror = () => reject(new Error(`Unable to load ${pdfJsScriptPath}.`));
    document.head.append(script);
  });

  return pdfJsLoadPromise;
}

async function renderPdfPages(pdfjs, pdf, article, pages, viewerId, renderVersion, zoom) {
  if (!pdfViewerIsActive(viewerId, article)) return;

  const containerWidth = Math.floor(pages.clientWidth);
  if (!containerWidth) return;

  const outputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), maxPdfOutputScale);
  const nextPages = document.createDocumentFragment();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (!pdfViewerIsActive(viewerId, article) || renderVersion !== article.dataset.renderVersion) return;

    const page = await pdf.getPage(pageNumber);
    if (!pdfViewerIsActive(viewerId, article) || renderVersion !== article.dataset.renderVersion) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = containerWidth / baseViewport.width;
    const scale = fitScale * zoom;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const pageShell = document.createElement("figure");
    pageShell.className = "archive-pdf-page";
    pageShell.dataset.pageNumber = String(pageNumber);
    pageShell.setAttribute("aria-label", `Page ${pageNumber} of ${pdf.numPages}`);
    pageShell.style.width = `${Math.floor(viewport.width)}px`;
    pageShell.style.height = `${Math.floor(viewport.height)}px`;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const textLayer = document.createElement("div");
    textLayer.className = "archive-pdf-text-layer textLayer";
    textLayer.style.width = `${Math.floor(viewport.width)}px`;
    textLayer.style.height = `${Math.floor(viewport.height)}px`;

    pageShell.append(canvas, textLayer);
    nextPages.append(pageShell);

    await page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    }).promise;
    if (!pdfViewerIsActive(viewerId, article) || renderVersion !== article.dataset.renderVersion) return;

    const textContent = await page.getTextContent();
    if (!pdfViewerIsActive(viewerId, article) || renderVersion !== article.dataset.renderVersion) return;

    await pdfjs.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
      textDivs: []
    }).promise;
    if (!pdfViewerIsActive(viewerId, article) || renderVersion !== article.dataset.renderVersion) return;
  }

  pages.replaceChildren(nextPages);
}

async function renderPdfViewer(file, article, pages, status, controls) {
  const viewerId = (activePdfViewerId += 1);
  let pdf = null;
  let zoom = 1;
  let currentPage = 1;
  let isRendering = false;
  let needsRender = false;
  let scrollUpdateFrame = 0;

  try {
    const pdfjs = await loadPdfJs();
    if (!pdfViewerIsActive(viewerId, article)) return;

    pdfjs.GlobalWorkerOptions.workerSrc = pdfJsWorkerPath;
    const loadingTask = pdfjs.getDocument(directFileHref(file));
    pdf = await loadingTask.promise;
    if (!pdfViewerIsActive(viewerId, article)) return;

    status.hidden = true;
    article.removeAttribute("aria-busy");

    const syncZoomControls = () => {
      controls.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      controls.zoomOut.disabled = isRendering || zoom <= minPdfZoom + 0.001;
      controls.zoomIn.disabled = isRendering || zoom >= maxPdfZoom - 0.001;
    };
    const syncPageControls = () => {
      const totalPages = pdf?.numPages ?? 1;
      controls.pageLabel.textContent = `Page ${currentPage} / ${totalPages}`;
      controls.previousPage.disabled = currentPage <= 1;
      controls.nextPage.disabled = currentPage >= totalPages;
    };
    const updateCurrentPageFromScroll = () => {
      const pageElements = Array.from(pages.querySelectorAll(".archive-pdf-page"));
      if (!pageElements.length) return;

      const viewportRect = controls.viewport.getBoundingClientRect();
      const viewportCenter = viewportRect.top + viewportRect.height / 2;
      let nearestPage = currentPage;
      let nearestDistance = Number.POSITIVE_INFINITY;

      pageElements.forEach((pageElement) => {
        const rect = pageElement.getBoundingClientRect();
        const pageCenter = rect.top + rect.height / 2;
        const distance = Math.abs(pageCenter - viewportCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPage = Number(pageElement.dataset.pageNumber) || nearestPage;
        }
      });

      if (nearestPage !== currentPage) {
        currentPage = nearestPage;
        syncPageControls();
      }
    };
    const scheduleCurrentPageUpdate = () => {
      if (scrollUpdateFrame) return;
      scrollUpdateFrame = window.requestAnimationFrame(() => {
        scrollUpdateFrame = 0;
        updateCurrentPageFromScroll();
      });
    };
    const scrollToPage = (pageNumber) => {
      const targetPage = pages.querySelector(`[data-page-number="${pageNumber}"]`);
      if (!targetPage) return;
      controls.viewport.scrollTo({
        top: targetPage.offsetTop - pages.offsetTop,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    };

    const renderCurrentSize = async () => {
      if (!pdfViewerIsActive(viewerId, article)) return;
      if (isRendering) {
        needsRender = true;
        return;
      }
      isRendering = true;
      syncZoomControls();
      const renderVersion = String((pdfRenderSequence += 1));
      const hasRenderedPages = pages.hasChildNodes();
      let renderStatusTimeout = null;
      article.dataset.renderVersion = renderVersion;
      status.textContent = "Rendering PDF";
      if (hasRenderedPages) {
        status.hidden = true;
        renderStatusTimeout = window.setTimeout(() => {
          if (pdfViewerIsActive(viewerId, article) && renderVersion === article.dataset.renderVersion) {
            status.hidden = false;
          }
        }, pdfRenderStatusDelay);
      } else {
        status.hidden = false;
      }
      try {
        await renderPdfPages(pdfjs, pdf, article, pages, viewerId, renderVersion, zoom);
        if (pdfViewerIsActive(viewerId, article) && renderVersion === article.dataset.renderVersion) {
          status.hidden = true;
          updateCurrentPageFromScroll();
          syncPageControls();
        }
      } finally {
        if (renderStatusTimeout) window.clearTimeout(renderStatusTimeout);
        isRendering = false;
        syncZoomControls();
      }
      if (needsRender && pdfViewerIsActive(viewerId, article)) {
        needsRender = false;
        await renderCurrentSize();
      }
    };

    const changeZoom = async (step) => {
      if (isRendering) return;
      const nextZoom = Math.max(minPdfZoom, Math.min(maxPdfZoom, zoom + step));
      if (Math.abs(nextZoom - zoom) < 0.001) return;

      const scrollRange = controls.viewport.scrollHeight - controls.viewport.clientHeight;
      const previousScrollRatio = scrollRange > 0 ? controls.viewport.scrollTop / scrollRange : 0;
      zoom = Math.round(nextZoom * 10) / 10;
      syncZoomControls();
      await renderCurrentSize();

      const nextScrollRange = controls.viewport.scrollHeight - controls.viewport.clientHeight;
      controls.viewport.scrollTop = previousScrollRatio * nextScrollRange;
      updateCurrentPageFromScroll();
    };

    controls.zoomOut.addEventListener("click", () => {
      changeZoom(-pdfZoomStep).catch((error) => {
        console.error("PDF zoom unavailable", error);
      });
    });
    controls.zoomIn.addEventListener("click", () => {
      changeZoom(pdfZoomStep).catch((error) => {
        console.error("PDF zoom unavailable", error);
      });
    });
    controls.previousPage.addEventListener("click", () => {
      scrollToPage(Math.max(1, currentPage - 1));
    });
    controls.nextPage.addEventListener("click", () => {
      scrollToPage(Math.min(pdf.numPages, currentPage + 1));
    });
    controls.viewport.addEventListener("scroll", scheduleCurrentPageUpdate, { passive: true });

    syncZoomControls();
    syncPageControls();
    await renderCurrentSize();
  } catch (error) {
    console.error("PDF preview unavailable", error);
    if (!pdfViewerIsActive(viewerId, article)) return;
    article.removeAttribute("aria-busy");
    status.hidden = false;
    status.textContent = "PDF preview unavailable. Use Open PDF to view the file.";
  }
}

function maintenanceNotice(index) {
  const article = document.createElement("article");
  article.className = "maintenance-notice";
  article.innerHTML = `
    <span>${index.emptyWarning}</span>
    <strong>${index.emptyTitle}</strong>
    <p>${index.emptyMessage}</p>
  `;
  return article;
}

function renderDocuments(route) {
  const index = route.node;
  if (index.kind !== "index") {
    documentPanel.hidden = true;
    replaceDocumentList();
    documentDirectLink.hidden = true;
    return;
  }

  documentPanel.hidden = false;
  if (route.document) {
    documentDirectLink.href = directFileHref(route.document);
    documentsTitle.innerHTML = route.document.title;
    activeSectionKicker.textContent = route.document.archiveId;
    documentDirectLink.hidden = true;
    documentList.className = "document-list layout-viewer";
    replaceDocumentList(documentViewer(route.document));
    return;
  }

  documentDirectLink.hidden = true;
  documentsTitle.textContent = index.title;
  activeSectionKicker.textContent =
    index.availability === "available" ? "Open Index" : "Index Under Maintenance";
  documentList.className = `document-list layout-${index.layout}`;

  if (!index.documents.length) {
    replaceDocumentList(maintenanceNotice(index));
    return;
  }

  replaceDocumentList(
    ...index.documents.map((file) =>
      index.layout === "cards" ? documentCard(file, route.path) : documentRow(file, route.path)
    )
  );
}

function scrollActiveViewIntoPlace() {
  const target = navigationBar.hidden
    ? documentPanel.hidden
      ? directorySection
      : documentPanel
    : navigationBar;
  if (!target) return;
  window.requestAnimationFrame(() => {
    const targetTop = window.scrollY + target.getBoundingClientRect().top - 10;
    if (targetTop <= window.scrollY) return;
    window.scrollTo({
      top: targetTop,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });
}

function render() {
  const route = getRoute();
  syncCleanUrl(route);
  renderSummary();
  renderBreadcrumbs(route);
  renderDirectory(route);
  renderDocuments(route);
}

function handleHashChange() {
  render();
  if (mobileViewport.matches) scrollActiveViewIntoPlace();
}

generationStamp.textContent = formatTimestamp(archiveManifest.generatedAt);
Array.from(summaryButtons).forEach((button) => {
  button.addEventListener("click", () => {
    activeSummaryView = button.dataset.summaryView;
    renderSummary();
  });
});
window.addEventListener("hashchange", handleHashChange);
window.addEventListener("popstate", handleHashChange);
if (mobileViewport.addEventListener) {
  mobileViewport.addEventListener("change", render);
} else {
  mobileViewport.addListener(render);
}
render();
