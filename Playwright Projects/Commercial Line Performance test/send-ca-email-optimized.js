// Final optimized email reporter for CA parallel test runs
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Read results from temp file written by PowerShell
const tempFilePath = path.join(__dirname, 'ca-email-temp.json');

if (!fs.existsSync(tempFilePath)) {
  console.error('Error: ca-email-temp.json not found. Email cannot be sent.');
  process.exit(1);
}

let emailData;
try {
  const rawData = fs.readFileSync(tempFilePath, 'utf8');
  emailData = JSON.parse(rawData);
} catch (e) {
  console.error('Failed to read or parse email data:', e.message);
  process.exit(1);
}

let resultsData = emailData.results || [];
if (!Array.isArray(resultsData)) {
  resultsData = Object.values(resultsData);
}

const testEnv = (emailData.env || 'QA').toUpperCase();

if (resultsData.length === 0) {
  console.log('No results to email. Exiting.');
  process.exit(0);
}

// Parse coverage stats from both dropdowns and add coverage functions
function parseCombinedCoverageStats(results) {
  const coverageMap = new Map(); // Key: coverage name, Value: { detail, times[], status, count }
  
  results.forEach(result => {
    if (!result.Milestones || !Array.isArray(result.Milestones)) return;
    
    result.Milestones.forEach(milestone => {
      const mileName = milestone.name || '';
      const duration = parseFloat(milestone.duration) || 0;
      let coverageSection = null;
      let detail = null;
      let status = 'Updated';
      
      // Pattern 1: "Coverage section: X dropdown(s) updated"
      if (mileName.includes('additional Coverage Added')) {
        coverageSection = 'Commercial Auto additional Coverage Added';
        detail = 'Coverage Added';
        status = 'Added';
      } 
      // Pattern 2: Dropdown updates from processCoverageDropdowns
      else if (mileName.includes('Liability') || mileName.includes('Coverage')) {
        // Extract coverage name and dropdown count from milestone name
        const match = mileName.match(/(\d+)\s+dropdown/i);
        const dropdownCount = match ? match[1] : '1';
        coverageSection = mileName.replace(/:\s*\d+.*$/i, '').trim();
        detail = `${dropdownCount} dropdown(s) updated`;
        status = 'Updated';
      }
      
      if (coverageSection) {
        if (!coverageMap.has(coverageSection)) {
          coverageMap.set(coverageSection, {
            detail: detail || 'N/A',
            times: [],
            status: status,
            count: 0
          });
        }
        const entry = coverageMap.get(coverageSection);
        if (duration > 0) entry.times.push(duration);
        entry.count++;
      }
    });
  });
  
  // Convert to array and calculate averages
  const coverageArray = Array.from(coverageMap.entries()).map(([name, data]) => {
    const avgTime = data.times.length > 0 
      ? (data.times.reduce((a, b) => a + b, 0) / data.times.length).toFixed(2)
      : 'N/A';
    return {
      name,
      detail: data.detail,
      status: data.status,
      avgTime,
      times: data.times,
      count: data.count
    };
  });
  
  // Sort by frequency and then by time
  return coverageArray.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return parseFloat(b.avgTime) - parseFloat(a.avgTime);
  });
}

const coverageStats = parseCombinedCoverageStats(resultsData);

// Calculate average milestone durations across all states
function calculateAverageMilestones(results) {
  const milestoneMap = new Map(); // Key: milestone name, Value: { durations[], stateCounts[], avgDuration }
  
  results.forEach(result => {
    if (!result.Milestones || !Array.isArray(result.Milestones)) return;
    
    result.Milestones.forEach((milestone, idx) => {
      const name = milestone.name || 'Unknown Milestone';
      const durationStr = milestone.duration || '';
      
      // Parse duration (format: "12.34s")
      const durationMatch = durationStr.match(/(\d+\.?\d*)/);
      const duration = durationMatch ? parseFloat(durationMatch[1]) : null;
      
      if (!milestoneMap.has(name)) {
        milestoneMap.set(name, {
          durations: [],
          states: [],
          rank: idx + 1 // Use first occurrence rank
        });
      }
      
      const entry = milestoneMap.get(name);
      if (duration !== null && duration > 0) {
        entry.durations.push(duration);
        entry.states.push(result.State);
      }
    });
  });
  
  // Convert to array with averages
  const avgMilestones = Array.from(milestoneMap.entries())
    .map(([name, data]) => {
    const avgDuration = data.durations.length > 0
      ? (data.durations.reduce((a, b) => a + b, 0) / data.durations.length).toFixed(2)
      : 'N/A';
    const minDuration = data.durations.length > 0 ? Math.min(...data.durations).toFixed(2) : 'N/A';
    const maxDuration = data.durations.length > 0 ? Math.max(...data.durations).toFixed(2) : 'N/A';
    
    return {
      rank: data.rank,
      name,
      avgDuration,
      minDuration,
      maxDuration,
      occurrences: data.durations.length,
      states: [...new Set(data.states)].join(', ')
    };
  });
  
  // Sort by rank (execution order)
  return avgMilestones.sort((a, b) => a.rank - b.rank);
}

const averageMilestones = calculateAverageMilestones(resultsData);

// Calculate aggregate statistics
function calculateAggregateStats(results) {
  const stats = {
    totalStates: results.length,
    passedCount: 0,
    failedCount: 0,
    totalDuration: 0,
    avgDuration: 0
  };

  results.forEach(result => {
    if (result.Status === 'PASSED') stats.passedCount++;
    else stats.failedCount++;
    
    stats.totalDuration += parseFloat(result.Duration || 0);
  });

  stats.avgDuration = (stats.totalDuration / stats.totalStates).toFixed(2);
  return stats;
}

const aggregateStats = calculateAggregateStats(resultsData);

// Create SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.donegalgroup.com',
  port: parseInt(process.env.SMTP_PORT || '25'),
  secure: false,
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined,
  tls: {
    rejectUnauthorized: false
  }
});

// Build compact test summary (one line)
const overallStatus = aggregateStats.failedCount === 0 ? '✓ PASSED' : '✗ FAILED';
const overallStatusColor = aggregateStats.failedCount === 0 ? '#4CAF50' : '#f44336';

// Build iteration summary table
// (Now using aggregated Coverage_Changes and Coverage_Section_Stats data for email body)

// Prepare combined coverage metrics for email body
// Use coverageSectionStats (which tracks all visited sections) - ONLY from passed states
const coverageMetricsAggregated = {};
resultsData.forEach(result => {
  // Only process PASSED states
  if (result.Status !== 'PASSED') return;
  
  // First, add data from coverageSectionStats (which includes all visited sections)
  if (result.coverageSectionStats && Array.isArray(result.coverageSectionStats)) {
    result.coverageSectionStats.forEach(section => {
      const sectionName = section.coverageSection || 'Unknown';
      const duration = parseFloat(section.durationSeconds) || 0;

      if (!coverageMetricsAggregated[sectionName]) {
        coverageMetricsAggregated[sectionName] = {
          durations: [],
          states: new Set(),
          occurrences: 0
        };
      }

      // Always add duration (even if 0) to show accurate metrics
      coverageMetricsAggregated[sectionName].durations.push(duration);
      coverageMetricsAggregated[sectionName].states.add(result.State);
      coverageMetricsAggregated[sectionName].occurrences++;
    });
  }
});

const timestamp = new Date().toLocaleString('en-US', { 
  dateStyle: 'full', 
  timeStyle: 'short' 
});

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { background-color: white; padding: 18px; max-width: 1200px; margin: 0 auto; }
    .header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; border-bottom: 3px solid #1976d2; padding-bottom: 8px; }
    .header h1 { color: #1976d2; margin: 0; font-size: 22px; font-weight: bold; }
    .header-icon { font-size: 26px; }
    
    .summary-line { background-color: #f5f5f5; padding: 8px; margin: 6px 0; border-radius: 2px; border-left: 3px solid #1976d2; font-size: 12px; line-height: 1.3; }
    .summary-item { display: inline-block; margin-right: 18px; }
    .summary-label { font-weight: bold; color: #333; }
    .summary-value { color: #1976d2; font-weight: bold; }
    
    .section-title { font-size: 13px; font-weight: bold; color: #333; margin-top: 10px; margin-bottom: 6px; border-bottom: 2px solid #1976d2; padding-bottom: 3px; }
    
    table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 10px; line-height: 1.2; }
    th { background-color: #1976d2; color: white; padding: 4px 5px; text-align: left; font-weight: bold; white-space: nowrap; }
    td { border: 1px solid #ddd; padding: 3px 4px; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    
    .footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd; color: #666; font-size: 10px; text-align: center; line-height: 1.3; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-icon">🚗</div>
      <h1>WB Smoke Testing Report</h1>
    </div>
    
    <div class="summary-line">
      <div class="summary-item">
        <span class="summary-label">Overall Status:</span>
        <span class="summary-value" style="color: ${overallStatusColor};">${overallStatus}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Total Iterations:</span>
        <span class="summary-value">${aggregateStats.totalStates}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Passed:</span>
        <span class="summary-value" style="color: #4CAF50;">${aggregateStats.passedCount}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Failed:</span>
        <span class="summary-value" style="color: #f44336;">${aggregateStats.failedCount}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Success Rate:</span>
        <span class="summary-value">${((aggregateStats.passedCount / aggregateStats.totalStates) * 100).toFixed(1)}%</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Total Duration:</span>
        <span class="summary-value">${aggregateStats.totalDuration.toFixed(2)}s</span>
      </div>
    </div>
    
    <div class="section-title">Metrics for Coverages Added/Updated</div>
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:10px;line-height:1.2;">
      <thead>
        <tr style="background:#1976d2;color:white;">
          <th style="padding:4px 5px;text-align:left;border:1px solid #ddd;white-space:nowrap;">Coverage Section</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Avg (s)</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Min</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Max</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Occ</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">States</th>
          <th style="padding:4px 5px;text-align:left;border:1px solid #ddd;white-space:nowrap;">State List</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(coverageMetricsAggregated)
          .map(([section, data], idx) => {
            // Format duration with appropriate unit (ms or s)
            const formatDuration = (seconds) => {
              if (seconds === 0) return '0ms';
              const ms = seconds * 1000;
              return ms < 100 ? `${Math.round(ms)}ms` : `${seconds.toFixed(1)}s`;
            };
            
            const avgDur = data.durations.length > 0 
              ? formatDuration(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
              : '0ms';
            const minDur = data.durations.length > 0 ? formatDuration(Math.min(...data.durations)) : '0ms';
            const maxDur = data.durations.length > 0 ? formatDuration(Math.max(...data.durations)) : '0ms';
            const bgColor = idx % 2 === 0 ? '#ffffff' : '#f9f9f9';
            return `
              <tr style="background-color: ${bgColor};">
                <td style="padding:3px 4px;border:1px solid #ddd;font-weight:bold;font-size:9px;">${section}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${avgDur}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${minDur}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${maxDur}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${data.occurrences}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${data.states.size}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;font-size:8px;">${Array.from(data.states).sort().join(', ')}</td>
              </tr>
            `;
          })
          .sort((a, b) => {
            const nameA = a.match(/<td[^>]*>([^<]+)<\/td>/)[1];
            const nameB = b.match(/<td[^>]*>([^<]+)<\/td>/)[1];
            return nameA.localeCompare(nameB);
          })
          .join('')}
      </tbody>
    </table>
    
    <div class="section-title">Page Navigation Metrics</div>
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:10px;line-height:1.2;">
      <thead>
        <tr style="background:#1976d2;color:white;">
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Rank</th>
          <th style="padding:4px 5px;text-align:left;border:1px solid #ddd;white-space:nowrap;">Milestone</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Avg (s)</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Min</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Max</th>
          <th style="padding:4px 5px;text-align:center;border:1px solid #ddd;white-space:nowrap;">Occ</th>
          <th style="padding:4px 5px;text-align:left;border:1px solid #ddd;white-space:nowrap;">States</th>
        </tr>
      </thead>
      <tbody>
        ${averageMilestones
          .map((milestone, idx) => {
            const bgColor = idx % 2 === 0 ? '#ffffff' : '#f9f9f9';
            return `
              <tr style="background-color: ${bgColor};">
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-weight:bold;font-size:9px;">${idx + 1}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;font-size:9px;">${milestone.name}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${milestone.avgDuration}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${milestone.minDuration}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${milestone.maxDuration}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;text-align:center;font-size:9px;">${milestone.occurrences}</td>
                <td style="padding:3px 4px;border:1px solid #ddd;font-size:8px;">${milestone.states}</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
    
    <div class="footer">
      <p><strong>Report Generated:</strong> ${timestamp}</p>
      <p><strong>Environment:</strong> ${testEnv}</p>
      <p><strong>Note:</strong> Detailed state-wise metrics and historical data are available in the attached Excel file.</p>
    </div>
  </div>
</body>
</html>
`;

// Create Excel report with detailed milestone information per state
function createExcelReport(results) {
  try {
    const wb = XLSX.utils.book_new();
    
    // Summary sheet
    const summaryData = [{
      'Overall Status': overallStatus,
      'Total States': aggregateStats.totalStates,
      'Passed': aggregateStats.passedCount,
      'Failed': aggregateStats.failedCount,
      'Success Rate (%)': ((aggregateStats.passedCount / aggregateStats.totalStates) * 100).toFixed(1),
      'Total Duration (s)': aggregateStats.totalDuration.toFixed(2),
      'Avg Duration per State (s)': aggregateStats.avgDuration,
      'Report Generated': timestamp,
      'Environment': testEnv
    }];
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Coverage Summary sheet
    const coverageSummaryData = coverageStats.map((cov, idx) => ({
      'Rank': idx + 1,
      'Coverage Section': cov.name,
      'Detail': cov.detail,
      'Status': cov.status,
      'Average Time (s)': cov.avgTime,
      'Occurrences': cov.count
    }));
    const coverageSummaryWs = XLSX.utils.json_to_sheet(coverageSummaryData);
    XLSX.utils.book_append_sheet(wb, coverageSummaryWs, 'Coverage Summary');
    
    // Iteration summary sheet
    const iterationData = results.map((result, idx) => ({
      'Iteration #': idx + 1,
      'State': result.State,
      'Line of Business': `CA (${result.State})`,
      'Quote Number': result.QuoteNumber || 'N/A',
      'Policy Number': result.PolicyNumber || 'N/A',
      'Overall Status': result.Status,
      'Duration (s)': result.Duration || 'N/A'
    }));
    const iterationWs = XLSX.utils.json_to_sheet(iterationData);
    XLSX.utils.book_append_sheet(wb, iterationWs, 'Iterations');
    
    // Average Milestones Across States sheet
    const avgMilestoneData = averageMilestones.map((m, idx) => ({
      'Rank': m.rank,
      'Milestone': m.name,
      'Average Duration (s)': m.avgDuration,
      'Min Duration (s)': m.minDuration,
      'Max Duration (s)': m.maxDuration,
      'Occurrences': m.occurrences,
      'States': m.states
    }));
    const avgMilestoneWs = XLSX.utils.json_to_sheet(avgMilestoneData);
    XLSX.utils.book_append_sheet(wb, avgMilestoneWs, 'Avg Milestones');
    
    // Email Table 1: Coverage Metrics (from email body)
    const emailCoverageMetricsData = Object.entries(coverageMetricsAggregated)
      .map(([section, data]) => ({
        'Coverage Section': section,
        'Avg Duration (s)': data.durations.length > 0 
          ? (data.durations.reduce((a, b) => a + b, 0) / data.durations.length).toFixed(2)
          : 'N/A',
        'Min Duration (s)': data.durations.length > 0 ? Math.min(...data.durations).toFixed(2) : 'N/A',
        'Max Duration (s)': data.durations.length > 0 ? Math.max(...data.durations).toFixed(2) : 'N/A',
        'Occurrences': data.occurrences,
        'States Covered': data.states.size,
        'States List': Array.from(data.states).sort().join(', ')
      }))
      .sort((a, b) => a['Coverage Section'].localeCompare(b['Coverage Section']));
    if (emailCoverageMetricsData.length > 0) {
      const emailCoverageWs = XLSX.utils.json_to_sheet(emailCoverageMetricsData);
      XLSX.utils.book_append_sheet(wb, emailCoverageWs, 'Email_Coverage_Metrics');
    }
    
    // Email Table 2: Page Navigation Metrics (from email body)
    const emailNavigationMetricsData = averageMilestones.map((m) => ({
      'Rank': m.rank,
      'Milestone': m.name,
      'Average Duration (s)': m.avgDuration,
      'Min Duration (s)': m.minDuration,
      'Max Duration (s)': m.maxDuration,
      'Occurrences': m.occurrences,
      'States': m.states
    }));
    if (emailNavigationMetricsData.length > 0) {
      const emailNavWs = XLSX.utils.json_to_sheet(emailNavigationMetricsData);
      XLSX.utils.book_append_sheet(wb, emailNavWs, 'Email_Navigation_Metrics');
    }
    
    // Coverage Changes - Aggregated by Section (average across all states)
    const coverageChangesAggregated = {};
    results.forEach(result => {
      (result.coverageChanges || []).forEach(change => {
        const section = change.coverageSection || 'Unknown';
        if (!coverageChangesAggregated[section]) {
          coverageChangesAggregated[section] = {
            durations: [],
            states: new Set(),
            updateCount: 0
          };
        }
        const duration = parseFloat(change.durationSeconds) || 0;
        if (duration > 0) {
          coverageChangesAggregated[section].durations.push(duration);
        }
        coverageChangesAggregated[section].states.add(result.State);
        coverageChangesAggregated[section].updateCount++;
      });
    });
    
    const coverageChangesAvgData = Object.entries(coverageChangesAggregated)
      .map(([section, data]) => ({
        'Coverage Section': section,
        'Total Dropdown Updates': data.updateCount,
        'Average Duration (s)': data.durations.length > 0 
          ? (data.durations.reduce((a, b) => a + b, 0) / data.durations.length).toFixed(2) 
          : 'N/A',
        'Min Duration (s)': data.durations.length > 0 ? Math.min(...data.durations).toFixed(2) : 'N/A',
        'Max Duration (s)': data.durations.length > 0 ? Math.max(...data.durations).toFixed(2) : 'N/A',
        'States Covered': data.states.size,
        'States List': Array.from(data.states).sort().join(', ')
      }))
      .sort((a, b) => b['Total Dropdown Updates'] - a['Total Dropdown Updates']);
    
    if (coverageChangesAvgData.length > 0) {
      const coverageChangesAvgWs = XLSX.utils.json_to_sheet(coverageChangesAvgData);
      XLSX.utils.book_append_sheet(wb, coverageChangesAvgWs, 'Coverage_Changes_Avg');
    }
    
    // Coverage Changes sheet (granular dropdown details - all states)
    const coverageChangesData = [];
    results.forEach(result => {
      (result.coverageChanges || []).forEach(change => {
        coverageChangesData.push({
          'State': result.State,
          'Quote Number': change.quoteNumber || 'N/A',
          'Coverage Section': change.coverageSection || 'N/A',
          'Coverage': change.coverage || 'N/A',
          'Old Value': change.oldValue || 'N/A',
          'New Value': change.newValue || 'N/A',
          'Status': change.status || 'N/A',
          'Duration (s)': change.durationSeconds || '0'
        });
      });
    });
    if (coverageChangesData.length > 0) {
      const coverageChangesWs = XLSX.utils.json_to_sheet(coverageChangesData);
      XLSX.utils.book_append_sheet(wb, coverageChangesWs, 'Coverage_Changes_Detail');
    }
    
    // Coverage Section Timings - Aggregated by Section (average across all states)
    const coverageSectionAggregated = {};
    results.forEach(result => {
      (result.coverageSectionStats || []).forEach(section => {
        const sectionName = section.coverageSection || 'Unknown';
        if (!coverageSectionAggregated[sectionName]) {
          coverageSectionAggregated[sectionName] = {
            durations: [],
            states: new Set(),
            totalDropdownsUpdated: 0,
            totalDropdownsFound: 0,
            occurrences: 0
          };
        }
        const duration = parseFloat(section.durationSeconds) || 0;
        if (duration > 0) {
          coverageSectionAggregated[sectionName].durations.push(duration);
        }
        coverageSectionAggregated[sectionName].states.add(result.State);
        coverageSectionAggregated[sectionName].totalDropdownsUpdated += (section.dropdownsUpdated || 0);
        coverageSectionAggregated[sectionName].totalDropdownsFound += (section.dropdownsFound || 0);
        coverageSectionAggregated[sectionName].occurrences++;
      });
    });
    
    const coverageSectionAvgData = Object.entries(coverageSectionAggregated)
      .map(([section, data]) => ({
        'Coverage Section': section,
        'Total Dropdowns Updated': data.totalDropdownsUpdated,
        'Total Dropdowns Found': data.totalDropdownsFound,
        'Average Duration (s)': data.durations.length > 0 
          ? (data.durations.reduce((a, b) => a + b, 0) / data.durations.length).toFixed(2) 
          : 'N/A',
        'Min Duration (s)': data.durations.length > 0 ? Math.min(...data.durations).toFixed(2) : 'N/A',
        'Max Duration (s)': data.durations.length > 0 ? Math.max(...data.durations).toFixed(2) : 'N/A',
        'Occurrences': data.occurrences,
        'States Covered': data.states.size,
        'States List': Array.from(data.states).sort().join(', ')
      }))
      .sort((a, b) => b['Total Dropdowns Updated'] - a['Total Dropdowns Updated']);
    
    if (coverageSectionAvgData.length > 0) {
      const coverageSectionAvgWs = XLSX.utils.json_to_sheet(coverageSectionAvgData);
      XLSX.utils.book_append_sheet(wb, coverageSectionAvgWs, 'Coverage_Section_Avg');
    }
    
    // Coverage Section Timings sheet (section-level stats - all states detail)
    const coverageSectionData = [];
    results.forEach(result => {
      (result.coverageSectionStats || []).forEach(section => {
        coverageSectionData.push({
          'State': result.State,
          'Quote Number': section.quoteNumber || 'N/A',
          'Coverage Section': section.coverageSection || 'N/A',
          'Dropdowns Updated': section.dropdownsUpdated || 0,
          'Dropdowns Found': section.dropdownsFound || 0,
          'Duration (s)': section.durationSeconds || '0'
        });
      });
    });
    if (coverageSectionData.length > 0) {
      const coverageSectionWs = XLSX.utils.json_to_sheet(coverageSectionData);
      XLSX.utils.book_append_sheet(wb, coverageSectionWs, 'Coverage_Section_Detail');
    }
    
    // Add Coverage Timings sheet
    const addCoverageData = [];
    results.forEach(result => {
      (result.addCoverageTimings || []).forEach(timing => {
        addCoverageData.push({
          'State': result.State,
          'Quote Number': result.QuoteNumber || 'N/A',
          'Action': timing.action || 'Add',
          'Step #': timing.index,
          'Coverage Name': timing.coverage || 'Unknown',
          'Duration (s)': timing.duration || '0'
        });
      });
    });
    if (addCoverageData.length > 0) {
      const addCoverageWs = XLSX.utils.json_to_sheet(addCoverageData);
      XLSX.utils.book_append_sheet(wb, addCoverageWs, 'Add_Coverage_Timings');
    }
    
    // Per-state milestone details
    results.forEach((result, idx) => {
      if (result.Milestones && Array.isArray(result.Milestones) && result.Milestones.length > 0) {
        const milestoneData = result.Milestones.map((m, mIdx) => ({
          'Rank': mIdx + 1,
          'Milestone': m.name || 'N/A',
          'Status': m.status || 'N/A',
          'Duration (s)': m.duration || '-',
          'Timestamp': m.timestamp ? new Date(m.timestamp).toLocaleString() : '-'
        }));
        
        const ws = XLSX.utils.json_to_sheet(milestoneData);
        const sheetName = `${result.State}_Milestones`.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
      
      // Per-state coverage section details
      if (result.coverageSectionStats && Array.isArray(result.coverageSectionStats) && result.coverageSectionStats.length > 0) {
        const coverageDetailData = result.coverageSectionStats.map((section, sIdx) => ({
          'Rank': sIdx + 1,
          'Coverage Section': section.coverageSection || 'N/A',
          'Dropdowns Updated': section.dropdownsUpdated || 0,
          'Dropdowns Found': section.dropdownsFound || 0,
          'Duration (s)': section.durationSeconds || '0'
        }));
        
        const coverageWs = XLSX.utils.json_to_sheet(coverageDetailData);
        const coverageSheetName = `${result.State}_Coverage_Detail`.substring(0, 31);
        XLSX.utils.book_append_sheet(wb, coverageWs, coverageSheetName);
      }
    });
    
    const excelPath = path.join(__dirname, `WB_Test_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    XLSX.writeFile(wb, excelPath);
    console.log('✅ Excel report created:', excelPath);
    return excelPath;
  } catch (e) {
    console.error('⚠️ Failed to create Excel report:', e.message);
    return null;
  }
}

const excelFile = createExcelReport(resultsData);

function createFallbackExcelReport(results) {
  try {
    const wb = XLSX.utils.book_new();
    const fallbackRows = results.map((result, idx) => ({
      'Iteration #': idx + 1,
      'State': result.State || 'N/A',
      'Status': result.Status || 'N/A',
      'Duration (s)': result.Duration || 'N/A',
      'Quote Number': result.QuoteNumber || 'N/A',
      'Policy Number': result.PolicyNumber || 'N/A',
      'Milestone Count': Array.isArray(result.Milestones) ? result.Milestones.length : 0
    }));
    const ws = XLSX.utils.json_to_sheet(fallbackRows.length ? fallbackRows : [{ Message: 'No result rows available' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    const fallbackPath = path.join(__dirname, `WB_Test_Report_Fallback_${new Date().toISOString().split('T')[0]}.xlsx`);
    XLSX.writeFile(wb, fallbackPath);
    console.log('✅ Fallback Excel report created:', fallbackPath);
    return fallbackPath;
  } catch (e) {
    console.error('⚠️ Failed to create fallback Excel report:', e.message);
    return null;
  }
}

const finalExcelFile = excelFile || createFallbackExcelReport(resultsData);

// Send email
const mailOptions = {
  from: process.env.FROM_EMAIL || 'automation@donegalgroup.com',
  to: process.env.TO_EMAIL || 'amitmishra@donegalgroup.com',
  subject: `WB Smoke Testing Report: ${testEnv} - ${aggregateStats.passedCount}/${aggregateStats.totalStates} Passed`,
  html: htmlContent,
  attachments: finalExcelFile ? [{ filename: path.basename(finalExcelFile), path: finalExcelFile }] : []
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Failed to send email:', error.message);
    process.exit(1);
  } else {
    console.log('✅ Email sent successfully:', info.messageId);
    process.exit(0);
  }
});
