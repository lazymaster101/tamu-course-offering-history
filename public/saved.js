import {
  buildExplorerUrl,
  formatSavedCourseCode,
  getSavedCourses,
  hasSavedCourse,
  removeCourse,
  saveCourse
} from "./saved-courses.js";
import { startSavedCourseBadgeSync } from "./page-shell.js";

const elements = {
  cartState: document.querySelector("#cart-state"),
  cartList: document.querySelector("#cart-list"),
  favoritesState: document.querySelector("#favorites-state"),
  favoritesList: document.querySelector("#favorites-list"),
  template: document.querySelector("#saved-course-template")
};

function setActionButtonState(button, isActive, activeLabel, inactiveLabel) {
  button.textContent = isActive ? activeLabel : inactiveLabel;
  button.classList.toggle("is-active", isActive);
}

function formatCourseMeta(course) {
  const parts = [course.campusLabel];

  if (course.offeringCount) {
    parts.push(`${course.offeringCount} offered terms`);
  }

  if (course.latestTermDescription) {
    parts.push(`Latest seen: ${course.latestTermDescription}`);
  }

  return parts.join(" • ");
}

function createTag(label, tone) {
  const tag = document.createElement("span");
  tag.className = `syllabus-badge${tone ? ` is-${tone}` : ""}`;
  tag.textContent = label;
  return tag;
}

function createSavedCourseCard(course, primaryCollection) {
  const fragment = elements.template.content.cloneNode(true);
  const tags = fragment.querySelector(".saved-course-tags");
  const titleNode = fragment.querySelector(".saved-course-title");
  const codeNode = fragment.querySelector(".saved-course-code");
  const metaNode = fragment.querySelector(".saved-course-meta");
  const openLink = fragment.querySelector(".saved-course-link");
  const toggleCartButton = fragment.querySelector(".saved-toggle-cart");
  const toggleFavoriteButton = fragment.querySelector(".saved-toggle-favorite");

  codeNode.textContent = formatSavedCourseCode(course);
  titleNode.textContent = course.title;
  metaNode.textContent = formatCourseMeta(course);
  openLink.href = buildExplorerUrl(course);

  tags.append(createTag(primaryCollection === "cart" ? "Cart" : "Favorite", "muted"));
  tags.append(createTag(course.campusLabel, "standard"));

  setActionButtonState(
    toggleCartButton,
    hasSavedCourse("cart", course),
    "Remove from cart",
    "Add to cart"
  );
  setActionButtonState(
    toggleFavoriteButton,
    hasSavedCourse("favorites", course),
    "Remove favorite",
    "Add favorite"
  );

  toggleCartButton.addEventListener("click", () => {
    if (hasSavedCourse("cart", course)) {
      removeCourse("cart", course);
    } else {
      saveCourse("cart", course);
    }
    renderSavedCourses();
  });

  toggleFavoriteButton.addEventListener("click", () => {
    if (hasSavedCourse("favorites", course)) {
      removeCourse("favorites", course);
    } else {
      saveCourse("favorites", course);
    }
    renderSavedCourses();
  });

  return fragment;
}

function renderCollection(collectionName, stateNode, listNode) {
  const courses = getSavedCourses(collectionName);
  listNode.innerHTML = "";

  if (!courses.length) {
    stateNode.hidden = false;
    listNode.hidden = true;
    return;
  }

  stateNode.hidden = true;
  listNode.hidden = false;
  courses.forEach((course) => {
    listNode.append(createSavedCourseCard(course, collectionName));
  });
}

function renderSavedCourses() {
  renderCollection("cart", elements.cartState, elements.cartList);
  renderCollection("favorites", elements.favoritesState, elements.favoritesList);
}

startSavedCourseBadgeSync();
renderSavedCourses();
