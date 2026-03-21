# Design System: The Academic Curator

## 1. Overview & Creative North Star
The "Creative North Star" for this design system is **The Academic Curator**. 

Most university portals feel like bureaucratic spreadsheets—cold, rigid, and exhausting. This system breaks that mold by treating degree planning as a high-end editorial experience. We combine the tactile warmth of physical archives with the precision of a modern productivity suite. 

To achieve this, we lean into **Intentional Asymmetry** and **Textural Depth**. Instead of a standard 12-column grid that feels clinical, we use overlapping "paper" layers and high-contrast typography scales. The experience should feel like a custom-bound leather planner: authoritative, organized, yet deeply personal.

---

## 2. Colors
Our palette is rooted in tradition but executed with modern sophistication.

*   **Primary Palette:** `primary_container` (#500000) serves as our foundational anchor—an deep, authoritative maroon.
*   **The Neutral Base:** We strictly avoid sterile #FFFFFF. The `background` (#fcf9f6) and `surface` tiers use a warm cream to reduce eye strain and mimic high-grade vellum.
*   **The "No-Line" Rule:** To maintain a premium feel, **1px solid borders for sectioning are prohibited.** Boundaries must be defined through background color shifts. For example, a `surface_container_low` section sitting on a `surface` background creates a clear but soft boundary that feels architectural rather than "drawn."
*   **Surface Hierarchy & Nesting:** Treat the UI as physical layers.
    *   **Level 0:** `background` (#fcf9f6) – The desk surface.
    *   **Level 1:** `surface_container` (#f0edea) – The primary card or "sheet."
    *   **Level 2:** `surface_container_highest` (#e5e2df) – Inset elements or secondary content blocks within a card.
*   **The Glass & Gradient Rule:** For floating navigation or AI chat overlays, use **Glassmorphism**. Apply `surface_variant` with 80% opacity and a 20px backdrop-blur. Main CTAs should utilize a subtle linear gradient from `primary` (#270000) to `primary_container` (#500000) to add "soul" and depth.

---

## 3. Typography
The typographic system relies on the tension between a soulful Serif and a clinical Grotesk.

*   **Editorial Authority (Newsreader):** Used for all `display` and `headline` tiers. The Newsreader serif provides an expressive, intellectual tone. High-scale titles (e.g., `display-lg` at 3.5rem) should feel like a magazine masthead—confident and timeless.
*   **Modern Utility (Space Grotesk):** Used for `title`, `body`, and `label` tiers. This font handles the heavy lifting of UI data. Its monospaced-leaning geometric forms provide the "tech" in "Academic-Tech," ensuring that course codes and credit numbers are hyper-legible.
*   **Visual Hierarchy:** Use `headline-md` (Newsreader) for section headers and `label-md` (Space Grotesk, All-Caps) for functional metadata to create a clear "Search/Read" distinction.

---

## 4. Elevation & Depth
We eschew traditional drop shadows in favor of **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by stacking the `surface-container` tiers. A `surface_container_lowest` (#ffffff) card placed atop a `surface_container` (#f0edea) section creates an organic "lift" without the "muddy" look of standard shadows.
*   **Ambient Shadows:** If a floating element (like a modal or dropdown) requires a shadow, use a 32px blur at 6% opacity. The shadow color must be a tinted variant of `on_surface` (espresso), never pure black, to mimic ambient room lighting.
*   **The Ghost Border Fallback:** If accessibility requires a border, use the `outline_variant` token at 15% opacity. This creates a "hairline" effect that defines the edge without breaking the editorial flow.
*   **Glassmorphism:** Use `surface_container_low` with a backdrop blur for persistent headers. This allows the primary maroon and cream textures of the page to bleed through as the user scrolls, maintaining a sense of place.

---

## 5. Components

### Primary Inputs & Fields
*   **Input Fields:** Use `surface_container_lowest` for the field background. Forbid 1px borders. Use a `3.5` (1.2rem) padding and a `sm` (0.25rem) corner radius. The focus state is signaled by a subtle glow using the `surface_tint` color, not a thick ring.
*   **Checkboxes & Radios:** These should feel like "marks" on a page. When checked, use `primary_container` with `on_primary` (white) icons.

### Buttons & Actions
*   **Primary Button:** Maroon fill (`primary_container`) with Cream text (`surface`). Use `rounded-md` (0.75rem) to balance softness and structure.
*   **Secondary/Tertiary Actions:** No fill. Use `on_surface_variant` (charcoal) with a subtle underline or a `surface_container` hover state.

### Lists & Cards
*   **Forbid Divider Lines:** Content separation is achieved through vertical whitespace (using the `spacing-6` or `spacing-8` tokens) or tonal shifts.
*   **Academic Chips:** Used for course statuses (e.g., "Completed," "In Progress"). Use `tertiary_fixed` (Copper/Gold) for high-importance highlights and `secondary_fixed` (Warm Grey) for neutral data.

### AI & Progress Tools
*   **The "Semester Cart":** A persistent container using `surface_container_high`. Elements inside should use dashed "Ghost Borders" to indicate their "draft" or "planned" status, differentiating them from "official" transcript data.

---

## 6. Do’s and Don’ts

### Do:
*   **Use Intentional White Space:** Embrace the `spacing-12` (4rem) and `spacing-16` (5.5rem) tokens between major sections to let the editorial typography breathe.
*   **Layer Tones:** Always place a lighter container on a darker surface to signify importance/focus.
*   **Use Asymmetry:** Align headings to the left while pushing utility buttons to the far right to create a "custom" layout feel.

### Don’t:
*   **Don't Use Pure Black or White:** It breaks the "Academic Curator" vibe. Always use `on_surface` (Espresso) and `background` (Cream).
*   **Don't Use "Bubbly" Corners:** Stick to the `DEFAULT` (0.5rem) or `md` (0.75rem) radii. Avoid `full` pill shapes unless they are for functional tags/chips.
*   **Don't Use Standard Grids:** Avoid perfectly even columns. Allow your main "Transcript" column to take up 65% of the width, with a "Planner AI" sidebar taking 35%, creating a weighted, professional balance.