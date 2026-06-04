<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:dev-server -->
## Dev Server

Always start the dev server on port **6688**:

```bash
npm run dev -- -p 6688
```

For cloud/server deployment, prefer production mode on port **6688**:

```bash
npm run build
npm run start -- -p 6688
```
<!-- END:dev-server -->

<!-- BEGIN:modification rules -->
When you made any change, do not change irrelevant files.
Always do TDD, always test after any change on code.
<!-- END:modification rules -->
