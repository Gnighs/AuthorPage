const bookList = document.querySelector("#book-list");
const latestReleaseCard = document.querySelector("#latest-release-card");
const currentProjectCard = document.querySelector("#current-project-card");
const booksManifest = window.booksManifest;
const detailStatuses = new Set(["released", "coming-soon"]);
const activeProjectStatuses = new Set(["coming-soon", "wip"]);

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

  if (canOpenDetail) {
    item.href = bookDetailPath(book, options.detailPrefix);
  } else {
    item.setAttribute("aria-disabled", "true");
  }

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

function statusLabel(book) {
  if (book.status === "released") return "Released";
  if (book.status === "coming-soon") return "Coming Soon";
  return "WIP";
}

function renderHomeFeature(wrapper, target, book) {
  if (!wrapper || !target || !book) return;
  target.replaceChildren(createBookItem(book, { assetPrefix: "books/", detailPrefix: "books/" }));
  wrapper.hidden = false;
}

function renderBooks() {
  const books = booksManifest?.items ?? [];

  if (bookList && !books.length) {
    const empty = document.createElement("p");
    empty.className = "book-empty";
    empty.textContent = "No books are listed yet.";
    bookList.replaceChildren(empty);
    return;
  }

  if (bookList) {
    bookList.replaceChildren(...books.map((book) => createBookItem(book)));
  }

  renderHomeFeature(
    latestReleaseCard?.closest("[data-home-book-feature]"),
    latestReleaseCard,
    newestBook(books.filter((book) => book.status === "released"))
  );
  renderHomeFeature(
    currentProjectCard?.closest("[data-home-book-feature]"),
    currentProjectCard,
    books.find((book) => book.current && activeProjectStatuses.has(book.status))
  );
}

renderBooks();
