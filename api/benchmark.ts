import latest from './latest.json' with { type: 'json' }

interface Deployment {
  name: string
  registry: string
  buildDuration: number | null
  state: string
  createdTime: string
}

export async function GET(request: Request) {
  // Group deployments by name
  const grouped = new Map<string, { npm?: Deployment; vsr?: Deployment }>()

  for (const deployment of latest as Deployment[]) {
    const name = deployment.name
    if (!grouped.has(name)) {
      grouped.set(name, {})
    }
    const group = grouped.get(name)!
    if (deployment.registry === 'npm') {
      group.npm = deployment
    } else if (deployment.registry === 'vsr') {
      group.vsr = deployment
    }
  }

  // Build comparisons maintaining the order from latest.json
  const comparisons: Array<{
    name: string
    npm: Deployment | undefined
    vsr: Deployment | undefined
    hasError: boolean
  }> = []

  // Track which names we've seen to maintain order from latest.json
  const seenNames = new Set<string>()

  for (const deployment of latest as Deployment[]) {
    const name = deployment.name
    if (!seenNames.has(name)) {
      seenNames.add(name)
      const group = grouped.get(name)!
      comparisons.push({
        name: name.replace('benchmark-', ''),
        npm: group.npm,
        vsr: group.vsr,
        hasError:
          !group.npm ||
          !group.vsr ||
          group.npm.state === 'ERROR' ||
          group.vsr.state === 'ERROR',
      })
    }
  }

  const validCount = comparisons.filter((c) => !c.hasError).length
  const errorCount = comparisons.filter((c) => c.hasError).length

  // Calculate total build times for valid comparisons
  const validComparisons = comparisons.filter((c) => !c.hasError)
  const totalNpmTime = validComparisons.reduce(
    (sum, c) => sum + (c.npm?.buildDuration || 0),
    0,
  )
  const totalVsrTime = validComparisons.reduce(
    (sum, c) => sum + (c.vsr?.buildDuration || 0),
    0,
  )

  // Find earliest and latest deployment times
  const allTimes = (latest as Deployment[])
    .map((d) => new Date(d.createdTime).getTime())
    .filter((t) => !isNaN(t))
  const earliestTime = Math.min(...allTimes)
  const latestTime = Math.max(...allTimes)
  const earliestDate = new Date(earliestTime).toLocaleString()
  const latestDate = new Date(latestTime).toLocaleString()

  // Generate HTML with bar charts for all comparisons
  const chartsHTML = comparisons
    .map((comparison) => {
      const npmState = comparison.npm?.state || 'MISSING'
      const vsrState = comparison.vsr?.state || 'MISSING'
      const npmTime = comparison.npm?.buildDuration
      const vsrTime = comparison.vsr?.buildDuration
      const hasError = comparison.hasError

      // Show bars if both have build times, otherwise show simple state view
      if (npmTime && vsrTime) {
        const maxForComparison = Math.max(npmTime, vsrTime)
        const npmPercent = (npmTime / maxForComparison) * 100
        const vsrPercent = (vsrTime / maxForComparison) * 100
        const npmSeconds = (npmTime / 1000).toFixed(2)
        const vsrSeconds = (vsrTime / 1000).toFixed(2)
        const speedup = (vsrTime / npmTime).toFixed(2)

        return `
        <div class="comparison">
          <h3>${comparison.name}</h3>
          <div class="chart">
            <div class="bar-row">
              <div class="label">npm</div>
              <div class="bar-container">
                <div class="bar npm-bar" style="width: ${npmPercent}%">
                  <span class="value">${npmSeconds}s</span>
                </div>
              </div>
              <div class="state-badge ${npmState === 'ERROR' ? 'error' : 'ready'}">${npmState}</div>
            </div>
            <div class="bar-row">
              <div class="label">vsr</div>
              <div class="bar-container">
                <div class="bar vsr-bar" style="width: ${vsrPercent}%">
                  <span class="value">${vsrSeconds}s</span>
                </div>
              </div>
              <div class="state-badge ${vsrState === 'ERROR' ? 'error' : 'ready'}">${vsrState}</div>
            </div>
          </div>
          <div class="speedup">${speedup}x ${vsrTime > npmTime ? 'slower' : 'faster'}${hasError ? ' <strong class="error-text">(with errors)</strong>' : ''}</div>
        </div>
        `
      } else {
        // Show simple state badges if no build times available
        return `
        <div class="comparison">
          <h3>${comparison.name}</h3>
          <div class="error-details">
            <div class="error-row">
              <div class="label">npm</div>
              <div class="state-badge ${npmState === 'ERROR' ? 'error' : 'missing'}">${npmState}</div>
              <div class="time">${npmTime ? (npmTime / 1000).toFixed(2) + 's' : 'N/A'}</div>
            </div>
            <div class="error-row">
              <div class="label">vsr</div>
              <div class="state-badge ${vsrState === 'ERROR' ? 'error' : 'missing'}">${vsrState}</div>
              <div class="time">${vsrTime ? (vsrTime / 1000).toFixed(2) + 's' : 'N/A'}</div>
            </div>
          </div>
        </div>
        `
      }
    })
    .join('')

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Is vsr on Vercel Fast Yet?</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      text-align: center;
      color: #333;
      margin-bottom: 20px;
    }
    .answer {
      text-align: center;
      font-size: 72px;
      font-weight: 900;
      margin: 0 0 20px 0;
      padding: 20px;
      border-radius: 12px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
    }
    .answer.yes {
      color: #27ae60;
      background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
      border: 3px solid #27ae60;
    }
    .answer.no {
      color: #e74c3c;
      background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
      border: 3px solid #e74c3c;
    }
    .comparison {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h3 {
      margin: 0 0 15px 0;
      color: #444;
      font-size: 18px;
    }
    .chart {
      margin: 10px 0;
    }
    .bar-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }
    .label {
      width: 60px;
      font-weight: 600;
      font-size: 14px;
      color: #666;
      flex-shrink: 0;
    }
    .bar-container {
      flex: 1;
      display: flex;
      align-items: center;
    }
    .bar {
      height: 32px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      min-width: 60px;
      transition: all 0.3s ease;
    }
    .npm-bar {
      background: linear-gradient(90deg, #CB3837 0%, #E74C3C 100%);
      color: white;
    }
    .vsr-bar {
      background: #000000;
      color: white;
    }
    .value {
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
    }
    .speedup {
      margin-top: 8px;
      font-size: 14px;
      color: #666;
      font-weight: 500;
    }
    .summary {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      text-align: center;
    }
    .summary-comparison {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border: 2px solid #007bff;
    }
    .summary-comparison h3 {
      color: #007bff;
      font-size: 20px;
    }
    .summary-comparison .speedup {
      font-size: 16px;
    }
    .summary h2 {
      margin: 0 0 10px 0;
      color: #333;
    }
    .summary p {
      margin: 5px 0;
      color: #666;
    }
    .timestamps {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      font-size: 14px;
    }
    .timestamps p {
      margin: 3px 0;
    }
    .error-text {
      color: #e74c3c;
    }
    .error-details {
      margin: 10px 0;
    }
    .error-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      gap: 10px;
    }
    .state-badge {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      margin-left: 10px;
      flex-shrink: 0;
    }
    .state-badge.error {
      background: #e74c3c;
      color: white;
    }
    .state-badge.ready {
      background: #27ae60;
      color: white;
    }
    .state-badge.missing {
      background: #95a5a6;
      color: white;
    }
    .time {
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>Is vsr on Vercel Fast Yet?</h1>
  ${
    totalNpmTime > 0 && totalVsrTime > 0
      ? `<div class="answer ${totalVsrTime < totalNpmTime ? 'yes' : 'no'}">
    ${totalVsrTime < totalNpmTime ? 'YES' : 'NO'}
  </div>`
      : ''
  }
  <div class="summary">
    <p><strong>${validCount + errorCount}</strong> total projects (<strong class="error-text">${errorCount}</strong> with errors)</p>
    <div class="timestamps">
      <p><strong>Earliest deployment:</strong> ${earliestDate}</p>
      <p><strong>Latest deployment:</strong> ${latestDate}</p>
    </div>
  </div>
  ${
    totalNpmTime > 0 && totalVsrTime > 0
      ? `<div class="comparison summary-comparison">
    <h3>Total Build Time (${validCount} projects)</h3>
    <div class="chart">
      <div class="bar-row">
        <div class="label">npm</div>
        <div class="bar-container">
          <div class="bar npm-bar" style="width: ${(totalNpmTime / Math.max(totalNpmTime, totalVsrTime)) * 100}%">
            <span class="value">${(totalNpmTime / 1000).toFixed(2)}s</span>
          </div>
        </div>
        <div class="state-badge ready">TOTAL</div>
      </div>
      <div class="bar-row">
        <div class="label">vsr</div>
        <div class="bar-container">
          <div class="bar vsr-bar" style="width: ${(totalVsrTime / Math.max(totalNpmTime, totalVsrTime)) * 100}%">
            <span class="value">${(totalVsrTime / 1000).toFixed(2)}s</span>
          </div>
        </div>
        <div class="state-badge ready">TOTAL</div>
      </div>
    </div>
    <div class="speedup"><strong>${(totalVsrTime / totalNpmTime).toFixed(2)}x ${totalVsrTime > totalNpmTime ? 'slower' : 'faster'}</strong></div>
  </div>`
      : ''
  }
  ${chartsHTML}
</body>
</html>
`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}
