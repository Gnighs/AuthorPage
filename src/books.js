const bookList = document.querySelector("#book-list");
const bookMap = document.querySelector("#book-map");
const cardsTab = document.querySelector("#books-cards-tab");
const mapTab = document.querySelector("#books-map-tab");
const latestReleaseCard = document.querySelector("#latest-release-card");
const currentProjectCard = document.querySelector("#current-project-card");
const booksManifest = window.booksManifest;
const detailStatuses = new Set(["released", "coming-soon"]);
const activeProjectStatuses = new Set(["coming-soon", "wip"]);
const svgNamespace = "http://www.w3.org/2000/svg";

function assetPath(path, prefix = "") {
  if (!path || /^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("/")) return path;
  return `${prefix}${path}`;
}

function bookDetailPath(book, prefix = "") {
  if (book.slug) return `${prefix}${book.slug}/index.html`;
  return assetPath(book.detailUrl, prefix);
}

function cardDescription(book) {
  return String(book.shortDescription || book.blurb || "WIP").trim() || "WIP";
}

function readingColor(book) {
  return book.readingPrerequisites?.length ? "#fff4bc" : "#e69b00";
}

function createCover(book, options = {}) {
  const cover = document.createElement("span");
  cover.className = "book-cover";
  const image = document.createElement("img");
  image.src = assetPath(book.imageUrl, options.assetPrefix);
  image.alt = `${book.title} cover`;
  image.loading = "lazy";
  cover.append(image);
  if (book.status !== "released") {
    const watermark = document.createElement("span");
    watermark.className = "book-watermark";
    watermark.textContent = book.status === "coming-soon" ? "Coming Soon" : "WIP";
    cover.append(watermark);
  }
  return cover;
}

function createBookItem(book, options = {}) {
  const canOpenDetail = Boolean(book.hasDetailPage || detailStatuses.has(book.status));
  const item = document.createElement(canOpenDetail ? "a" : "article");
  item.className = `book-item${canOpenDetail ? " has-detail" : " wip"}`;
  item.style.setProperty("--book-highlight", book.highlightColor || "#4f6f59");
  if (canOpenDetail) item.href = bookDetailPath(book, options.detailPrefix);
  else item.setAttribute("aria-disabled", "true");

  const details = document.createElement("span");
  details.className = "book-details";
  const title = document.createElement("strong");
  title.textContent = book.title;
  const series = document.createElement("span");
  series.textContent = book.series;
  const date = document.createElement("span");
  date.className = "book-date";
  date.textContent = book.progressLabel || statusLabel(book);
  const description = document.createElement("p");
  description.textContent = cardDescription(book);
  details.append(series, title, date, description);
  item.append(createCover(book, options), details);
  return item;
}

function dateSortValue(book) {
  const value = String(book.date || "").trim();
  if (!value || value.toLowerCase() === "unknown") return Number.NEGATIVE_INFINITY;
  const yearMatch = value.match(/^\d{4}$/);
  if (yearMatch) return Date.UTC(Number(value), 0, 1);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function newestBook(books) {
  return [...books].sort((first, second) => dateSortValue(second) - dateSortValue(first))[0];
}

function publicationSortValue(book) {
  const value = String(book.date || "").trim();
  if (!value || value.toLowerCase() === "unknown") return Number.POSITIVE_INFINITY;
  const yearMatch = value.match(/^\d{4}$/);
  if (yearMatch) return Date.UTC(Number(value), 0, 1);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function statusLabel(book) {
  if (book.status === "released") return "Released";
  if (book.status === "coming-soon") return "Coming Soon";
  return "WIP";
}

function createBookGroup(title, books) {
  const section = document.createElement("section");
  section.className = "book-group";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "book-list";
  list.replaceChildren(...books.map((book) => createBookItem(book)));
  section.append(heading, list);
  return section;
}

function renderBookList(books) {
  if (!bookList) return;
  if (!books.length) {
    const empty = document.createElement("p");
    empty.className = "book-empty";
    empty.textContent = "No books are listed yet.";
    bookList.replaceChildren(empty);
    return;
  }
  const collections = [];
  const collectionMap = new Map();
  books.forEach((book) => {
    const collection = book.series || "Other Works";
    if (!collectionMap.has(collection)) {
      const group = [];
      collectionMap.set(collection, group);
      collections.push([collection, group]);
    }
    collectionMap.get(collection).push(book);
  });
  const content = collections.map(([collection, collectionBooks]) => {
    const sortedBooks = collectionBooks
      .map((book, index) => ({ book, index }))
      .sort((first, second) => (
        publicationSortValue(first.book) - publicationSortValue(second.book)
        || first.index - second.index
      ))
      .map(({ book }) => book);
    return createBookGroup(collection, sortedBooks);
  });
  bookList.replaceChildren(...content);
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function splitTitle(title, maxCharacters = 15) {
  const words = String(title).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function renderBookMap(books) {
  if (!bookMap) return;
  const shell = bookMap.querySelector(".book-map-canvas");
  const accessibleList = bookMap.querySelector(".book-map-accessible-list");
  if (!shell || !accessibleList) return;
  if (!books.length) {
    shell.replaceChildren();
    accessibleList.textContent = "No books are listed yet.";
    return;
  }

  const datedValues = [...new Set(
    books.map((book) => book.inWorldDate)
      .filter((value) => typeof value === "number" && Number.isFinite(value))
  )].sort((first, second) => first - second);
  const datedValueIndex = new Map(datedValues.map((value, index) => [value, index]));
  const undatedIndex = datedValues.length;
  const columnCount = datedValues.length + (books.some((book) => book.inWorldDate == null) ? 1 : 0);
  const columnGap = 230;
  const leftPadding = 130;
  const nodeRadius = 62;
  const topPadding = 170;
  const laneGap = 180;
  const collections = [...new Set(books.map((book) => book.series || "Other Works"))];
  const collectionIndex = new Map(collections.map((collection, index) => [collection, index]));

  books.forEach((book, index) => {
    const column = datedValueIndex.has(book.inWorldDate)
      ? datedValueIndex.get(book.inWorldDate)
      : undatedIndex;
    const lane = collectionIndex.get(book.series || "Other Works");
    book._mapPosition = { column, lane, index };
  });
  const height = Math.max(360, topPadding * 2 + Math.max(collections.length - 1, 0) * laneGap);
  const positions = new Map();
  books.forEach((book) => {
    const { column, lane, index } = book._mapPosition;
    positions.set(book.slug, {
      x: leftPadding + column * columnGap,
      y: topPadding + lane * laneGap,
      index
    });
    delete book._mapPosition;
  });

  const width = Math.max(720, leftPadding * 2 + Math.max(columnCount - 1, 0) * columnGap + nodeRadius);
  const svg = svgElement("svg", {
    class: "book-map-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-labelledby": "book-map-title book-map-description"
  });
  const title = svgElement("title", { id: "book-map-title" });
  title.textContent = "The Anserium Novels reading map";
  const description = svgElement("desc", { id: "book-map-description" });
  description.textContent = "Books are positioned from left to right by in-world date. Arrows show recommended reading prerequisites.";
  const definitions = svgElement("defs");
  const marker = svgElement("marker", {
    id: "book-map-arrow", viewBox: "0 0 10 10", refX: "8", refY: "5",
    markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse", markerUnits: "userSpaceOnUse"
  });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#6f5a36" }));
  definitions.append(marker);
  svg.append(title, description, definitions);

  const mapHeading = svgElement("g", { class: "book-map-svg-heading" });
  mapHeading.append(
    svgElement("line", { x1: "46", y1: "28", x2: String(width / 2 - 150), y2: "28" }),
    svgElement("line", { x1: String(width / 2 + 150), y1: "28", x2: String(width - 46), y2: "28" })
  );
  const mapHeadingText = svgElement("text", { x: String(width / 2), y: "38", "text-anchor": "middle" });
  mapHeadingText.textContent = "THE ANSERIUM NOVELS";
  mapHeading.append(mapHeadingText);
  svg.append(mapHeading);

  const edges = svgElement("g", { class: "book-map-edges", "aria-hidden": "true" });
  books.forEach((book) => {
    const target = positions.get(book.slug);
    const prerequisites = Array.isArray(book.readingPrerequisites) ? book.readingPrerequisites : [];
    prerequisites.forEach((prerequisiteSlug, edgeIndex) => {
      const source = positions.get(prerequisiteSlug);
      if (!source) return;
      const direction = target.x >= source.x ? 1 : -1;
      const startX = source.x + direction * nodeRadius;
      const endX = target.x - direction * nodeRadius;
      const bend = Math.max(48, Math.abs(endX - startX) * 0.34);
      const offset = prerequisites.length > 1 ? (edgeIndex - (prerequisites.length - 1) / 2) * 24 : 0;
      const controlY = (source.y + target.y) / 2 + offset;
      edges.append(svgElement("path", {
        d: `M ${startX} ${source.y} C ${startX + direction * bend} ${controlY}, ${endX - direction * bend} ${controlY}, ${endX} ${target.y}`,
        class: "book-map-edge", "marker-end": "url(#book-map-arrow)"
      }));
    });
  });
  svg.append(edges);

  const nodes = svgElement("g", { class: "book-map-nodes" });
  books.forEach((book) => {
    const position = positions.get(book.slug);
    const node = svgElement("g", {
      class: `book-map-node${book.status === "wip" ? " is-wip" : ""}`,
      transform: `translate(${position.x} ${position.y})`
    });
    const canOpenDetail = Boolean(book.hasDetailPage || detailStatuses.has(book.status));
    const group = canOpenDetail
      ? svgElement("a", { href: bookDetailPath(book), class: "book-map-node-link" })
      : null;
    const nodeContent = group || node;
    nodeContent.append(svgElement("circle", {
      r: nodeRadius, fill: readingColor(book), stroke: "#314b39"
    }));
    const text = svgElement("text", { class: "book-map-node-title", "text-anchor": "middle" });
    const titleLines = splitTitle(book.title);
    const startY = -((titleLines.length - 1) * 16) / 2 + 5;
    titleLines.forEach((line, lineIndex) => {
      const textLine = svgElement("tspan", { x: "0", y: startY + lineIndex * 16 });
      textLine.textContent = line;
      text.append(textLine);
    });
    nodeContent.append(text);
    if (canOpenDetail) {
      const hint = svgElement("title");
      hint.textContent = `${book.title} — ${book.inWorldDate == null ? "undated" : `in-world date ${book.inWorldDate}`}`;
      group.append(hint);
      node.append(group);
    }
    nodes.append(node);
  });
  svg.append(nodes);

  const legend = svgElement("g", { class: "book-map-svg-legend" });
  const legendY = height - 28;
  legend.append(svgElement("line", { x1: "46", y1: String(legendY - 18), x2: String(width - 46), y2: String(legendY - 18) }));
  const legendItems = [
    { kind: "edge", label: "Prerequisite", width: 145 },
    { kind: "starter", label: "Starter", width: 100 },
    { kind: "continuation", label: "Continuation", width: 130 },
    { kind: "wip", label: "WIP", width: 75 }
  ];
  let legendX = 58;
  legendItems.forEach(({ kind, label, width: itemWidth }) => {
    if (kind === "edge") {
      legend.append(svgElement("line", {
        x1: String(legendX), y1: String(legendY), x2: String(legendX + 14), y2: String(legendY),
        class: "book-map-legend-edge", "marker-end": "url(#book-map-arrow)"
      }));
    } else if (kind === "wip") {
      legend.append(svgElement("circle", { cx: String(legendX + 7), cy: String(legendY), r: "7", class: "book-map-legend-wip" }));
    } else {
      legend.append(svgElement("circle", { cx: String(legendX + 7), cy: String(legendY), r: "7", class: `book-map-legend-${kind}` }));
    }
    const labelText = svgElement("text", { x: String(legendX + 20), y: String(legendY + 4) });
    labelText.textContent = label;
    legend.append(labelText);
    legendX += itemWidth;
  });
  svg.append(legend);
  shell.replaceChildren(svg);

  accessibleList.replaceChildren(...books.map((book) => {
    const item = document.createElement("li");
    const prerequisites = book.readingPrerequisites?.length
      ? ` Read after: ${book.readingPrerequisites.join(", ")}.`
      : " Starting point.";
    item.textContent = `${book.title}. ${book.inWorldDate == null ? "Undated." : `In-world date ${book.inWorldDate}.`}${prerequisites}`;
    return item;
  }));
}

function setBooksView(view, options = {}) {
  if (!bookList || !bookMap || !cardsTab || !mapTab) return;
  const showMap = view === "map";
  bookList.hidden = showMap;
  bookMap.hidden = !showMap;
  cardsTab.setAttribute("aria-selected", String(!showMap));
  mapTab.setAttribute("aria-selected", String(showMap));
  cardsTab.tabIndex = showMap ? -1 : 0;
  mapTab.tabIndex = showMap ? 0 : -1;

  if (options.persist === false) return;
  const url = new URL(window.location.href);
  if (showMap) url.searchParams.set("view", "map");
  else url.searchParams.delete("view");
  window.history.replaceState(null, "", url.href);
}

function renderHomeFeature(wrapper, target, book) {
  if (!wrapper || !target || !book) return;
  target.replaceChildren(createBookItem(book, { assetPrefix: "books/", detailPrefix: "books/" }));
  wrapper.hidden = false;
}

function renderBooks() {
  const books = booksManifest?.items ?? [];
  renderBookList(books);
  renderBookMap(books);
  const initialView = new URLSearchParams(window.location.search).get("view") === "map"
    ? "map"
    : "cards";
  setBooksView(initialView, { persist: false });
  cardsTab?.addEventListener("click", () => setBooksView("cards"));
  mapTab?.addEventListener("click", () => setBooksView("map"));
  renderHomeFeature(
    latestReleaseCard?.closest("[data-home-book-feature]"), latestReleaseCard,
    newestBook(books.filter((book) => book.status === "released"))
  );
  renderHomeFeature(
    currentProjectCard?.closest("[data-home-book-feature]"), currentProjectCard,
    books.find((book) => book.current && activeProjectStatuses.has(book.status))
  );
}

renderBooks();
