import { getSavedCourseCounts, subscribeToSavedCourses } from "./saved-courses.js";

export function syncSavedCourseBadges() {
  const counts = getSavedCourseCounts();
  const cartNodes = document.querySelectorAll("#cart-count-badge, #cart-count-summary");
  const favoriteNodes = document.querySelectorAll(
    "#favorite-count-badge, #favorite-count-summary"
  );

  cartNodes.forEach((node) => {
    node.textContent = String(counts.cart);
  });

  favoriteNodes.forEach((node) => {
    node.textContent = String(counts.favorites);
  });
}

export function startSavedCourseBadgeSync() {
  syncSavedCourseBadges();
  return subscribeToSavedCourses(syncSavedCourseBadges);
}
