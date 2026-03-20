# TAMU Syllabus Lookup

A small local webpage that sits on top of TAMU's public course APIs and fixes the repeated term-by-term search problem.

## What it does

- Searches TAMU course offerings by course code or title.
- Builds a semester history using the public TAMU catalog endpoint.
- Lazy-loads section rows only when you open a specific term.
- Links straight to Simple Syllabus when a section exposes a syllabus.
- Caches TAMU API responses in [`.cache/`](/Users/seshadithyasaravanan/Desktop/Public%20Class%20Search/.cache) so repeat searches are much faster.

## Run it

```bash
npm start
```

Then open [http://localhost:4321](http://localhost:4321).

## Notes

- No dependencies are required. It uses the built-in Node HTTP server and `fetch`.
- The first search is the slow one because the app has to warm local catalog caches for the selected TAMU terms.
- Section data comes from TAMU's public `course-sections` endpoint and syllabus links use TAMU's Simple Syllabus redirect format.
