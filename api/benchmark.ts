import latest from './latest.json' with { type: 'json' }

interface Deployment {
  name: string
  registry: string
  buildTime: number | null
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

  // Separate valid comparisons and error comparisons
  const allComparisons = Array.from(grouped.entries())
    .map(([name, group]) => ({
      name: name.replace('benchmark-', ''),
      npm: group.npm,
      vsr: group.vsr,
      hasError:
        !group.npm ||
        !group.vsr ||
        group.npm.state === 'ERROR' ||
        group.vsr.state === 'ERROR',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const validComparisons = allComparisons
    .filter((c) => !c.hasError)
    .map((c) => ({
      name: c.name,
      npm: c.npm!.buildTime!,
      vsr: c.vsr!.buildTime!,
    }))

  const errorComparisons = allComparisons.filter((c) => c.hasError)

  // Find earliest and latest deployment times
  const allTimes = (latest as Deployment[])
    .map((d) => new Date(d.createdTime).getTime())
    .filter((t) => !isNaN(t))
  const earliestTime = Math.min(...allTimes)
  const latestTime = Math.max(...allTimes)
  const earliestDate = new Date(earliestTime).toLocaleString()
  const latestDate = new Date(latestTime).toLocaleString()

  // Generate HTML with bar charts
  const chartsHTML = validComparisons
    .map((comparison) => {
      // Calculate percentages relative to the max of the two values in this comparison
      const maxForComparison = Math.max(comparison.npm, comparison.vsr)
      const npmPercent = (comparison.npm / maxForComparison) * 100
      const vsrPercent = (comparison.vsr / maxForComparison) * 100
      const npmSeconds = (comparison.npm / 1000).toFixed(2)
      const vsrSeconds = (comparison.vsr / 1000).toFixed(2)
      const speedup = (comparison.vsr / comparison.npm).toFixed(2)

      return `
      <div class="comparison">
        <h3>${comparison.name}</h3>
        <div class="chart">
          <div class="bar-row">
            <div class="label">npm</div>
            <div class="bar npm-bar" style="width: ${npmPercent}%">
              <span class="value">${npmSeconds}s</span>
            </div>
          </div>
          <div class="bar-row">
            <div class="label">vsr</div>
            <div class="bar vsr-bar" style="width: ${vsrPercent}%">
              <span class="value">${vsrSeconds}s</span>
            </div>
          </div>
        </div>
        <div class="speedup">${speedup}x ${comparison.vsr > comparison.npm ? 'slower' : 'faster'}</div>
      </div>
    `
    })
    .join('')

  const errorsHTML = errorComparisons
    .map((comparison) => {
      const npmState = comparison.npm?.state || 'MISSING'
      const vsrState = comparison.vsr?.state || 'MISSING'
      const npmTime = comparison.npm?.buildTime
      const vsrTime = comparison.vsr?.buildTime

      // Calculate bar widths if both have build times
      let npmBar = ''
      let vsrBar = ''

      if (npmTime && vsrTime) {
        const maxForComparison = Math.max(npmTime, vsrTime)
        const npmPercent = (npmTime / maxForComparison) * 100
        const vsrPercent = (vsrTime / maxForComparison) * 100
        const npmSeconds = (npmTime / 1000).toFixed(2)
        const vsrSeconds = (vsrTime / 1000).toFixed(2)
        const speedup = (vsrTime / npmTime).toFixed(2)

        npmBar = `
          <div class="bar-row">
            <div class="label">npm</div>
            <div class="bar-container">
              <div class="bar npm-bar ${npmState === 'ERROR' ? 'error-bar' : ''}" style="width: ${npmPercent}%">
                <span class="value">${npmSeconds}s</span>
              </div>
            </div>
            <div class="state-badge ${npmState === 'ERROR' ? 'error' : ''}">${npmState}</div>
          </div>
        `
        vsrBar = `
          <div class="bar-row">
            <div class="label">vsr</div>
            <div class="bar-container">
              <div class="bar vsr-bar ${vsrState === 'ERROR' ? 'error-bar' : ''}" style="width: ${vsrPercent}%">
                <span class="value">${vsrSeconds}s</span>
              </div>
            </div>
            <div class="state-badge ${vsrState === 'ERROR' ? 'error' : ''}">${vsrState}</div>
          </div>
        `

        return `
        <div class="comparison error-comparison">
          <h3>${comparison.name}</h3>
          <div class="chart">
            ${npmBar}
            ${vsrBar}
          </div>
          <div class="speedup error-speedup">${speedup}x ${vsrTime > npmTime ? 'slower' : 'faster'} (with errors)</div>
        </div>
        `
      } else {
        // Show simple state badges if no build times available
        return `
        <div class="comparison error-comparison">
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
  <title>Build Time Comparison: npm vs vsr</title>
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
      margin-bottom: 40px;
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
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      text-align: center;
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
    .errors-section {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #ddd;
    }
    .errors-section h2 {
      text-align: center;
      color: #e74c3c;
      margin-bottom: 20px;
    }
    .error-comparison {
      border-left: 4px solid #e74c3c;
    }
    .error-bar {
      opacity: 0.7;
      border: 2px solid #e74c3c;
    }
    .error-speedup {
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
  <h1>Build Time Comparison: npm vs vsr</h1>
  <div class="summary">
    <h2>Summary</h2>
    <p><strong>${validComparisons.length}</strong> valid comparisons</p>
    <p><strong>${errorComparisons.length}</strong> comparisons with errors</p>
    <div class="timestamps">
      <p><strong>Earliest deployment:</strong> ${earliestDate}</p>
      <p><strong>Latest deployment:</strong> ${latestDate}</p>
    </div>
  </div>
  ${chartsHTML}
  ${
    errorComparisons.length > 0
      ? `<div class="errors-section">
    <h2>Comparisons with Errors</h2>
    ${errorsHTML}
  </div>`
      : ''
  }
</body>
</html>
`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}
