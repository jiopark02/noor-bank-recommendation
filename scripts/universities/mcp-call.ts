/**
 * Call Supabase MCP directly
 */

async function callMCP() {
  const mcpUrl = 'https://mcp.supabase.com/mcp?features=docs,account,debugging,database,development,functions,branching,storage';

  console.log('Calling Supabase MCP...');

  try {
    // List available tools
    const listResponse = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });

    console.log('List tools response:', listResponse.status);
    const listData = await listResponse.text();
    console.log(listData.substring(0, 500));

  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

callMCP();
