/**
 * Unit smoke for emptyBlogPublicStats (no OpenSearch required).
 */
import assert from "node:assert/strict";
import { emptyBlogPublicStats } from "../blog-stats.js";

const empty = emptyBlogPublicStats({ days: 7, slug: "demo" });
assert.equal(empty.totals.events, 0);
assert.equal(empty.totals.pageViews, 0);
assert.equal(empty.article?.slug, "demo");
assert.equal(empty.funnel.scrollDepth, 0);
assert.ok(empty.window.since.length > 0);

console.log("blog-stats empty payload: ok");
