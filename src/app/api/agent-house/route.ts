import { agentHouseReportMaxBytes } from '@/lib/agent-house';
import { listAgentHouseReports, saveAgentHouseReport } from '@/lib/server/agent-house';
import { analysisAdmin } from '@/lib/server/analysis';
import { requireAiStudyContext } from '@/lib/server/classroom';
import { errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { client, userId } = await requireAiStudyContext();
    return json({ runs: await listAgentHouseReports(client, userId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { userId } = await requireAiStudyContext();
    const input = await readJson(request, agentHouseReportMaxBytes);
    const result = await saveAgentHouseReport(analysisAdmin(), userId, input);
    return json(result, result.created ? 201 : 200);
  } catch (error) { return errorResponse(error); }
}
