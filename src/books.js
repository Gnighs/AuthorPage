const bookList = document.querySelector("#book-list");
const booksManifest = window.booksManifest;

function createCover(book) {
  const cover = document.createElement("span");
  cover.className = "book-cover";

  const image = document.createElement("img");
  image.src = book.imageUrl;
  image.alt = `${book.title} cover`;
  image.loading = "lazy";
  cover.append(image);

  if (!book.published) {
    const watermark = document.createElement("span");
    watermark.className = "book-watermark";
    watermark.textContent = "WIP";
    cover.append(watermark);
  }

  return cover;
}

function createBookItem(book) {
  const item = document.createElement(book.published ? "a" : "article");
  item.className = `book-item${book.published ? " published" : " wip"}`;

  if (book.published) {
    item.href = book.amazonUrl;
    item.target = "_blank";
    item.rel = "noopener";
  } else {
    item.setAttribute("aria-disabled", "true");
  }

  const details = document.createElement("span");
  details.className = "book-details";

  const title = document.createElement("strong");
  title.textContent = book.title;

  const series = document.createElement("span");
  series.textContent = book.series;

  const description = document.createElement("p");
  description.textContent = book.shortDescription;

  details.append(title, series, description);

  item.append(createCover(book), details);
  return item;
}

function renderBooks() {
  if (!bookList) return;
  const books = booksManifest?.items ?? [];

  if (!books.length) {
    const empty = document.createElement("p");
    empty.className = "book-empty";
    empty.textContent = "No books are listed yet.";
    bookList.replaceChildren(empty);
    return;
  }

  bookList.replaceChildren(...books.map(createBookItem));
}

renderBooks();
