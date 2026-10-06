import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { liveLotFacets } from "@/lib/fantasy/live-repository";

export const GET = withApi({ permission: "fantasy.read" }, async () => ok(await liveLotFacets()));
