import data_1 from './data/001.json' with { type: 'json' }
import data_2 from './data/002.json' with { type: 'json' }
import data_3 from './data/003.json' with { type: 'json' }
import data_4 from './data/004.json' with { type: 'json' }
import data_5 from './data/005.json' with { type: 'json' }
import data_6 from './data/006.json' with { type: 'json' }
import data_7 from './data/007.json' with { type: 'json' }
import data_8 from './data/008.json' with { type: 'json' } // Increased Neon compute
import data_9 from './data/009.json' with { type: 'json' } // Ensured warm cache
import data_10 from './data/010.json' with { type: 'json' } // Single joined query for package/versions
import data_11 from './data/011.json' with { type: 'json' } // warm cache again

const rawData = [
  data_1,
  data_2,
  data_3,
  data_4,
  data_5,
  data_6,
  data_7,
  data_8,
  data_9,
  data_10,
  data_11,
]

// Configuration: minimum number of days needed to show trend chart
const MIN_DAYS_FOR_CHART = 2

// All available data with dates, sorted by date (oldest first)
const allData = rawData.map((d) => ({
  date: (d as any)[0].createdTime,
  data: d,
}))

interface Deployment {
  name: string
  registry: string
  buildDuration: number | null
  state: string
  createdTime: string
  npmTime?: number | null
  fetchTiming?: [string, number][]
}

function getEffectiveDuration(deployment: Deployment): number | null {
  return deployment.npmTime ?? deployment.buildDuration
}

interface FetchTimingGap {
  url: string
  npmDuration: number
  vsrDuration: number
  gap: number
  speedDiff: number
}

interface FetchTimingGaps {
  manifest: FetchTimingGap[]
  manifestBySpeed: FetchTimingGap[]
  tarball: FetchTimingGap[]
  tarballBySpeed: FetchTimingGap[]
}

function analyzeFetchTimingGaps(
  npmDeployment?: Deployment,
  vsrDeployment?: Deployment,
): FetchTimingGaps {
  if (
    !npmDeployment?.fetchTiming?.length ||
    !vsrDeployment?.fetchTiming?.length
  ) {
    return {
      manifest: [],
      manifestBySpeed: [],
      tarball: [],
      tarballBySpeed: [],
    }
  }

  const npmTiming = new Map(
    npmDeployment.fetchTiming.map(([url, duration]) => [
      new URL(url).pathname.replace(/^\//, '').replaceAll(/%2F/gi, '/'),
      duration,
    ]),
  )
  const vsrTiming = new Map(
    vsrDeployment.fetchTiming.map(([url, duration]) => [
      new URL(url).pathname.replace(/^\/npm\//, '').replaceAll(/%2F/gi, '/'),
      duration,
    ]),
  )

  const manifestGaps: FetchTimingGap[] = []
  const tarballGaps: FetchTimingGap[] = []

  // Find common URLs and calculate gaps
  for (const [url, npmDuration] of npmTiming) {
    const vsrDuration = vsrTiming.get(url)
    if (vsrDuration !== undefined) {
      const gap: FetchTimingGap = {
        url,
        npmDuration,
        vsrDuration,
        gap: vsrDuration - npmDuration,
        speedDiff: vsrDuration / npmDuration,
      }

      // Separate by URL type
      if (url.endsWith('.tgz')) {
        tarballGaps.push(gap)
      } else {
        manifestGaps.push(gap)
      }
    }
  }

  // Create two versions: sorted by absolute gap and by speed difference
  // Default to absolute gap (total slowdown in ms)
  const manifestByGap = [...manifestGaps]
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10)
  const manifestBySpeed = [...manifestGaps]
    .sort((a, b) => b.speedDiff - a.speedDiff)
    .slice(0, 10)
  const tarballByGap = [...tarballGaps]
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10)
  const tarballBySpeed = [...tarballGaps]
    .sort((a, b) => b.speedDiff - a.speedDiff)
    .slice(0, 10)

  return {
    manifest: manifestByGap,
    manifestBySpeed,
    tarball: tarballByGap,
    tarballBySpeed,
  }
}

function processData(latest: Deployment[]) {
  // Group deployments by name
  const grouped = new Map<string, { npm?: Deployment; vsr?: Deployment }>()

  for (const deployment of latest) {
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
    fetchTimingGaps: FetchTimingGaps
  }> = []

  // Track which names we've seen to maintain order from latest.json
  const seenNames = new Set<string>()

  for (const deployment of latest) {
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
        fetchTimingGaps: analyzeFetchTimingGaps(group.npm, group.vsr),
      })
    }
  }

  const validCount = comparisons.filter((c) => !c.hasError).length
  const errorCount = comparisons.filter((c) => c.hasError).length

  // Calculate total build times for valid comparisons
  const validComparisons = comparisons.filter((c) => !c.hasError)
  const totalNpmTime = validComparisons.reduce(
    (sum, c) => sum + (c.npm ? getEffectiveDuration(c.npm) || 0 : 0),
    0,
  )
  const totalVsrTime = validComparisons.reduce(
    (sum, c) => sum + (c.vsr ? getEffectiveDuration(c.vsr) || 0 : 0),
    0,
  )

  // Find earliest and latest deployment times
  const allTimes = latest
    .map((d) => new Date(d.createdTime).getTime())
    .filter((t) => !isNaN(t))
  const earliestTime = Math.min(...allTimes)
  const latestTime = Math.max(...allTimes)
  const earliestDate = new Date(earliestTime).toLocaleString()
  const latestDate = new Date(latestTime).toLocaleString()

  return {
    comparisons,
    validCount,
    errorCount,
    totalNpmTime,
    totalVsrTime,
    earliestDate,
    latestDate,
  }
}

export async function GET(request: Request) {
  const latestDataEntry = allData[allData.length - 1]
  if (!latestDataEntry) {
    return new Response('No data available', { status: 404 })
  }

  // Process all data for client-side rendering
  const processedData = allData.map((dataEntry) => {
    const result = processData(dataEntry.data as Deployment[])
    return {
      date: dataEntry.date,
      ...result,
    }
  })

  // Calculate trend data across all available dates
  const trendData = processedData.map((entry) => ({
    date: entry.date,
    npmTotal: entry.totalNpmTime / 1000, // Convert to seconds
    vsrTotal: entry.totalVsrTime / 1000,
    npmAverage:
      entry.validCount > 0 ? entry.totalNpmTime / 1000 / entry.validCount : 0,
    vsrAverage:
      entry.validCount > 0 ? entry.totalVsrTime / 1000 / entry.validCount : 0,
    validCount: entry.validCount,
  }))

  const html = generateHTML(processedData, trendData)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}

function generateHTML(processedData: any[], trendData: any[]) {
  // Embed all processed data as JSON for client-side rendering
  const dataScript = `
    window.BENCHMARK_DATA = ${JSON.stringify(processedData)};
    window.TREND_DATA = ${JSON.stringify(trendData)};
    window.MIN_DAYS_FOR_CHART = ${MIN_DAYS_FOR_CHART};
  `

  return `
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
    .date-selector {
      background: white;
      border-radius: 8px;
      padding: 15px 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 15px;
    }
    .date-selector label {
      font-weight: 600;
      color: #333;
      font-size: 14px;
    }
    .date-selector select {
      padding: 8px 16px;
      border: 2px solid #007bff;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      color: #333;
      background: white;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .date-selector select:hover {
      background: #f8f9fa;
      border-color: #0056b3;
    }
    .date-selector select:focus {
      outline: none;
      box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
    }
    .trend-chart {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .trend-chart h3 {
      margin: 0 0 20px 0;
      color: #333;
      font-size: 18px;
      text-align: center;
    }
    .chart-container {
      position: relative;
      height: 300px;
      margin: 20px 0;
    }
    .chart-svg {
      width: 100%;
      height: 100%;
    }
    .chart-legend {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-top: 15px;
      font-size: 14px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .legend-color {
      width: 20px;
      height: 3px;
      border-radius: 2px;
    }
    .legend-color.npm {
      background: #CB3837;
    }
    .legend-color.vsr {
      background: #000000;
    }
    .hidden {
      display: none;
    }
    .fetch-timing-details {
      margin-top: 15px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      border: 1px solid #dee2e6;
    }
    .fetch-timing-details summary {
      cursor: pointer;
      font-weight: 600;
      color: #495057;
      padding: 5px;
      user-select: none;
    }
    .fetch-timing-details summary:hover {
      color: #007bff;
    }
    .fetch-timing-table {
      width: 100%;
      margin-top: 10px;
      border-collapse: collapse;
      font-size: 13px;
    }
    .fetch-timing-table th {
      background: #e9ecef;
      padding: 8px 10px;
      text-align: left;
      font-weight: 600;
      color: #495057;
      border-bottom: 2px solid #dee2e6;
    }
    .fetch-timing-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #dee2e6;
    }
    .fetch-timing-table tr:hover {
      background: #f1f3f5;
    }
    .fetch-url {
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
      font-size: 12px;
    }
    .gap-slower {
      color: #e74c3c;
      font-weight: 600;
    }
    .gap-faster {
      color: #27ae60;
      font-weight: 600;
    }
    .fetch-timing-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .sort-toggle {
      display: flex;
      gap: 5px;
      background: #e9ecef;
      border-radius: 6px;
      padding: 3px;
    }
    .sort-toggle-btn {
      padding: 6px 12px;
      border: none;
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: #666;
      transition: all 0.2s ease;
    }
    .sort-toggle-btn:hover {
      color: #333;
    }
    .sort-toggle-btn.active {
      background: white;
      color: #007bff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <h1>Is vsr on Vercel Fast Yet?</h1>
  <div class="date-selector">
    <label for="date-select">Select Date:</label>
    <select id="date-select"></select>
  </div>
  <div id="answer-container"></div>
  <div id="summary-container"></div>
  <div id="total-time-container"></div>
  <div id="trend-chart-container"></div>
  <div id="charts-container"></div>

  <script>
    ${dataScript}

    function renderComparison(comparison) {
      const npmState = comparison.npm?.state || 'MISSING';
      const vsrState = comparison.vsr?.state || 'MISSING';
      const npmTime = comparison.npm ? (comparison.npm.npmTime ?? comparison.npm.buildDuration) : null;
      const vsrTime = comparison.vsr ? (comparison.vsr.npmTime ?? comparison.vsr.buildDuration) : null;
      const hasError = comparison.hasError;
      const hasManifestTiming = comparison.fetchTimingGaps && comparison.fetchTimingGaps.manifest.length > 0;
      const hasTarballTiming = comparison.fetchTimingGaps && comparison.fetchTimingGaps.tarball.length > 0;
      const hasFetchTiming = hasManifestTiming || hasTarballTiming;

      if (npmTime && vsrTime) {
        const maxForComparison = Math.max(npmTime, vsrTime);
        const npmPercent = (npmTime / maxForComparison) * 100;
        const vsrPercent = (vsrTime / maxForComparison) * 100;
        const npmSeconds = (npmTime / 1000).toFixed(2);
        const vsrSeconds = (vsrTime / 1000).toFixed(2);
        const speedup = (vsrTime / npmTime).toFixed(2);

        let fetchTimingHTML = '';
        if (hasFetchTiming) {
          const comparisonId = comparison.name.replace(/[^a-zA-Z0-9]/g, '-');
          
          function renderTable(gaps, title, type) {
            const rows = gaps.map((gap, index) => {
              const gapSign = gap.gap > 0 ? '+' : '';
              const speedDiffText = gap.speedDiff.toFixed(2) + 'x';
              return \`
              <tr>
                <td>\${index + 1}</td>
                <td class="fetch-url" title="\${gap.url}">\${gap.url}</td>
                <td>\${gap.npmDuration}ms</td>
                <td>\${gap.vsrDuration}ms</td>
                <td class="\${gap.gap > 0 ? 'gap-slower' : 'gap-faster'}">\${gapSign}\${gap.gap}ms (\${speedDiffText})</td>
              </tr>
            \`;
            }).join('');
            
            return \`
              <details class="fetch-timing-details">
                <summary>\${title}</summary>
                <div class="fetch-timing-header">
                  <span style="font-size: 14px; font-weight: 600;">Sort by:</span>
                  <div class="sort-toggle">
                    <button class="sort-toggle-btn active" onclick="toggleSort('\${comparisonId}', '\${type}', 'gap')">Total Slowdown</button>
                    <button class="sort-toggle-btn" onclick="toggleSort('\${comparisonId}', '\${type}', 'speed')">Relative Difference</button>
                  </div>
                </div>
                <table class="fetch-timing-table" id="\${comparisonId}-\${type}-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>URL</th>
                      <th>npm</th>
                      <th>vsr</th>
                      <th>Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    \${rows}
                  </tbody>
                </table>
              </details>
            \`;
          }
          
          let manifestTableHTML = '';
          if (hasManifestTiming) {
            manifestTableHTML = renderTable(comparison.fetchTimingGaps.manifest, 'Top 10 Manifest Slow Downs', 'manifest');
          }
          
          let tarballTableHTML = '';
          if (hasTarballTiming) {
            tarballTableHTML = renderTable(comparison.fetchTimingGaps.tarball, 'Top 10 Tarball Slow Downs', 'tarball');
          }
          
          fetchTimingHTML = manifestTableHTML + tarballTableHTML;
        }

        return \`
        <div class="comparison">
          <h3>\${comparison.name}</h3>
          <div class="chart">
            <div class="bar-row">
              <div class="label">npm</div>
              <div class="bar-container">
                <div class="bar npm-bar" style="width: \${npmPercent}%">
                  <span class="value">\${npmSeconds}s</span>
                </div>
              </div>
              <div class="state-badge \${npmState === 'ERROR' ? 'error' : 'ready'}">\${npmState}</div>
            </div>
            <div class="bar-row">
              <div class="label">vsr</div>
              <div class="bar-container">
                <div class="bar vsr-bar" style="width: \${vsrPercent}%">
                  <span class="value">\${vsrSeconds}s</span>
                </div>
              </div>
              <div class="state-badge \${vsrState === 'ERROR' ? 'error' : 'ready'}">\${vsrState}</div>
            </div>
          </div>
          <div class="speedup">\${speedup}x \${vsrTime > npmTime ? 'slower' : 'faster'}\${hasError ? ' <strong class="error-text">(with errors)</strong>' : ''}</div>
          \${fetchTimingHTML}
        </div>
        \`;
      } else {
        return \`
        <div class="comparison">
          <h3>\${comparison.name}</h3>
          <div class="error-details">
            <div class="error-row">
              <div class="label">npm</div>
              <div class="state-badge \${npmState === 'ERROR' ? 'error' : 'missing'}">\${npmState}</div>
              <div class="time">\${npmTime ? (npmTime / 1000).toFixed(2) + 's' : 'N/A'}</div>
            </div>
            <div class="error-row">
              <div class="label">vsr</div>
              <div class="state-badge \${vsrState === 'ERROR' ? 'error' : 'missing'}">\${vsrState}</div>
              <div class="time">\${vsrTime ? (vsrTime / 1000).toFixed(2) + 's' : 'N/A'}</div>
            </div>
          </div>
        </div>
        \`;
      }
    }

    // Store current data globally for toggle functionality
    window.CURRENT_DATA = null;
    
    window.toggleSort = function(comparisonId, type, sortBy) {
      const data = window.CURRENT_DATA;
      if (!data) return;
      
      const comparison = data.comparisons.find(c => c.name.replace(/[^a-zA-Z0-9]/g, '-') === comparisonId);
      if (!comparison) return;
      
      // Get the appropriate data based on sort type
      const gaps = sortBy === 'gap' 
        ? comparison.fetchTimingGaps[type]
        : comparison.fetchTimingGaps[type + 'BySpeed'];
      
      // Update table content
      const table = document.getElementById(\`\${comparisonId}-\${type}-table\`);
      if (table) {
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = gaps.map((gap, index) => {
          const gapSign = gap.gap > 0 ? '+' : '';
          const speedDiffText = gap.speedDiff.toFixed(2) + 'x';
          return \`
            <tr>
              <td>\${index + 1}</td>
              <td class="fetch-url" title="\${gap.url}">\${gap.url}</td>
              <td>\${gap.npmDuration}ms</td>
              <td>\${gap.vsrDuration}ms</td>
              <td class="\${gap.gap > 0 ? 'gap-slower' : 'gap-faster'}">\${gapSign}\${gap.gap}ms (\${speedDiffText})</td>
            </tr>
          \`;
        }).join('');
      }
      
      // Update button states
      const details = table.closest('.fetch-timing-details');
      const buttons = details.querySelectorAll('.sort-toggle-btn');
      buttons.forEach(btn => {
        const btnSortBy = btn.textContent.includes('Total') ? 'gap' : 'speed';
        btn.classList.toggle('active', btnSortBy === sortBy);
      });
    };

    function renderTrendChart(trendData) {
      const padding = { top: 20, right: 40, bottom: 40, left: 60 };
      const chartWidth = 1000;
      const chartHeight = 300;
      const plotWidth = chartWidth - padding.left - padding.right;
      const plotHeight = chartHeight - padding.top - padding.bottom;

      const maxTime = Math.max(...trendData.flatMap(d => [d.npmAverage, d.vsrAverage]));
      const minTime = Math.min(...trendData.flatMap(d => [d.npmAverage, d.vsrAverage]));
      const yRange = maxTime - minTime;
      const yPadding = yRange * 0.1;
      const yMin = Math.max(0, minTime - yPadding);
      const yMax = maxTime + yPadding;

      const xStep = plotWidth / (trendData.length - 1);
      const npmPoints = trendData.map((d, i) => {
        const x = padding.left + i * xStep;
        const y = padding.top + plotHeight - ((d.npmAverage - yMin) / (yMax - yMin)) * plotHeight;
        return { x, y, value: d.npmAverage, count: d.validCount };
      });
      const vsrPoints = trendData.map((d, i) => {
        const x = padding.left + i * xStep;
        const y = padding.top + plotHeight - ((d.vsrAverage - yMin) / (yMax - yMin)) * plotHeight;
        return { x, y, value: d.vsrAverage, count: d.validCount };
      });

      const npmPath = npmPoints.map((p, i) => \`\${i === 0 ? 'M' : 'L'} \${p.x} \${p.y}\`).join(' ');
      const vsrPath = vsrPoints.map((p, i) => \`\${i === 0 ? 'M' : 'L'} \${p.x} \${p.y}\`).join(' ');

      const yAxisSteps = 5;
      const yAxisLabels = Array.from({ length: yAxisSteps }, (_, i) => {
        const value = yMin + (yMax - yMin) * (i / (yAxisSteps - 1));
        const y = padding.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
        return { y, label: value.toFixed(0) + 's' };
      });

      return \`
      <div class="trend-chart">
        <h3>Average Build Time per Project Trend</h3>
        <div class="chart-container">
          <svg class="chart-svg" viewBox="0 0 \${chartWidth} \${chartHeight}">
            \${yAxisLabels.map(label => \`
              <line x1="\${padding.left}" y1="\${label.y}" x2="\${chartWidth - padding.right}" y2="\${label.y}" 
                    stroke="#e0e0e0" stroke-width="1" stroke-dasharray="4,4" />
            \`).join('')}
            \${yAxisLabels.map(label => \`
              <text x="\${padding.left - 10}" y="\${label.y}" text-anchor="end" dominant-baseline="middle" 
                    font-size="12" fill="#666">\${label.label}</text>
            \`).join('')}
            \${trendData.map((d, i) => {
              const x = padding.left + i * xStep;
              return \`<text x="\${x}" y="\${chartHeight - padding.bottom + 20}" text-anchor="middle" 
                           font-size="12" fill="#666">\${d.date}</text>\`;
            }).join('')}
            <path d="\${npmPath}" fill="none" stroke="#CB3837" stroke-width="3" />
            <path d="\${vsrPath}" fill="none" stroke="#000000" stroke-width="3" />
            \${npmPoints.map(p => \`
              <circle cx="\${p.x}" cy="\${p.y}" r="5" fill="#CB3837" stroke="white" stroke-width="2">
                <title>npm: \${p.value.toFixed(2)}s avg (\${p.count} projects)</title>
              </circle>
            \`).join('')}
            \${vsrPoints.map(p => \`
              <circle cx="\${p.x}" cy="\${p.y}" r="5" fill="#000000" stroke="white" stroke-width="2">
                <title>vsr: \${p.value.toFixed(2)}s avg (\${p.count} projects)</title>
              </circle>
            \`).join('')}
          </svg>
        </div>
        <div class="chart-legend">
          <div class="legend-item">
            <div class="legend-color npm"></div>
            <span>npm</span>
          </div>
          <div class="legend-item">
            <div class="legend-color vsr"></div>
            <span>vsr</span>
          </div>
        </div>
      </div>
      \`;
    }

    function renderData(dateStr) {
      const data = window.BENCHMARK_DATA.find(d => d.date === dateStr);
      if (!data) return;
      
      // Store current data for toggle functionality
      window.CURRENT_DATA = data;

      // Update answer
      const answerContainer = document.getElementById('answer-container');
      if (data.totalNpmTime > 0 && data.totalVsrTime > 0) {
        const isFaster = data.totalVsrTime < data.totalNpmTime;
        answerContainer.innerHTML = \`
          <div class="answer \${isFaster ? 'yes' : 'no'}">
            \${isFaster ? 'YES' : 'NO'}
          </div>
        \`;
      } else {
        answerContainer.innerHTML = '';
      }

      // Update summary
      const summaryContainer = document.getElementById('summary-container');
      summaryContainer.innerHTML = \`
        <div class="summary">
          <p><strong>\${data.validCount + data.errorCount}</strong> total projects (<strong class="error-text">\${data.errorCount}</strong> with errors)</p>
          <div class="timestamps">
            <p><strong>Earliest deployment:</strong> \${data.earliestDate}</p>
            <p><strong>Latest deployment:</strong> \${data.latestDate}</p>
          </div>
        </div>
      \`;

      // Update total time comparison
      const totalTimeContainer = document.getElementById('total-time-container');
      if (data.totalNpmTime > 0 && data.totalVsrTime > 0 && data.validCount > 0) {
        const npmAverage = data.totalNpmTime / data.validCount;
        const vsrAverage = data.totalVsrTime / data.validCount;
        const maxTime = Math.max(npmAverage, vsrAverage);
        const npmPercent = (npmAverage / maxTime) * 100;
        const vsrPercent = (vsrAverage / maxTime) * 100;
        const npmSeconds = (npmAverage / 1000).toFixed(2);
        const vsrSeconds = (vsrAverage / 1000).toFixed(2);
        const npmTotal = (data.totalNpmTime / 1000).toFixed(2);
        const vsrTotal = (data.totalVsrTime / 1000).toFixed(2);
        const speedup = (vsrAverage / npmAverage).toFixed(2);

        totalTimeContainer.innerHTML = \`
          <div class="comparison summary-comparison">
            <h3>Average Build Time per Project (\${data.validCount} projects)</h3>
            <div class="chart">
              <div class="bar-row">
                <div class="label">npm</div>
                <div class="bar-container">
                  <div class="bar npm-bar" style="width: \${npmPercent}%">
                    <span class="value">\${npmSeconds}s avg</span>
                  </div>
                </div>
              </div>
              <div class="bar-row">
                <div class="label">vsr</div>
                <div class="bar-container">
                  <div class="bar vsr-bar" style="width: \${vsrPercent}%">
                    <span class="value">\${vsrSeconds}s avg</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="speedup"><strong>\${speedup}x \${vsrAverage > npmAverage ? 'slower' : 'faster'}</strong> (Total: npm \${npmTotal}s, vsr \${vsrTotal}s)</div>
          </div>
        \`;
      } else {
        totalTimeContainer.innerHTML = '';
      }

      // Update trend chart
      const trendChartContainer = document.getElementById('trend-chart-container');
      if (window.BENCHMARK_DATA.length >= window.MIN_DAYS_FOR_CHART && window.TREND_DATA.length >= window.MIN_DAYS_FOR_CHART) {
        trendChartContainer.innerHTML = renderTrendChart(window.TREND_DATA);
      } else {
        trendChartContainer.innerHTML = '';
      }

      // Update individual comparisons
      const chartsContainer = document.getElementById('charts-container');
      chartsContainer.innerHTML = data.comparisons.map(renderComparison).join('');
    }

    // Initialize dropdown
    const dateSelect = document.getElementById('date-select');
    window.BENCHMARK_DATA.forEach(d => {
      const option = document.createElement('option');
      option.value = d.date;
      option.textContent = d.date;
      dateSelect.appendChild(option);
    });

    // Handle date selection
    function handleDateChange() {
      const selectedDate = dateSelect.value;
      window.location.hash = selectedDate;
      renderData(selectedDate);
    }

    dateSelect.addEventListener('change', handleDateChange);

    // Handle hash changes
    function handleHashChange() {
      const hash = window.location.hash.slice(1);
      const selectedDate = hash || window.BENCHMARK_DATA[window.BENCHMARK_DATA.length - 1].date;
      dateSelect.value = selectedDate;
      renderData(selectedDate);
    }

    window.addEventListener('hashchange', handleHashChange);

    // Initial render
    handleHashChange();
  </script>
</body>
</html>
  `
}
