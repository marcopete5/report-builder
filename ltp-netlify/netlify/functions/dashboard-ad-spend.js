// /.netlify/functions/dashboard-ad-spend
// Ad Spend Dashboard API - Marketing Department
// Supports both real data from MongoDB and placeholder data for development

const { getDb } = require('./utils/database');
const { getCorsHeaders } = require('./utils/cors');
const { requireAdmin } = require('./utils/db-auth');

/**
 * Create indexes on ad_spend collection
 * @param {Db} db - MongoDB database instance
 */
async function createAdSpendIndexes(db) {
    try {
        await db.collection('ad_spend').createIndexes([
            { key: { date: -1 }, name: 'date_desc' },
            { key: { platform: 1, date: -1 }, name: 'platform_date' },
            { key: { campaign: 1, date: -1 }, name: 'campaign_date' }
        ]);
    } catch (e) {
        // Index creation errors are non-fatal
    }
}

/**
 * Calculate metrics from ad spend data
 */
function calculateMetrics(data) {
    const totalSpend = data.reduce((sum, item) => sum + (item.spend || 0), 0);
    const totalImpressions = data.reduce((sum, item) => sum + (item.impressions || 0), 0);
    const totalClicks = data.reduce((sum, item) => sum + (item.clicks || 0), 0);
    const totalConversions = data.reduce((sum, item) => sum + (item.conversions || 0), 0);
    const totalRevenue = data.reduce((sum, item) => sum + (item.revenue || 0), 0);

    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const roi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0;
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

    return {
        totalSpend: totalSpend.toFixed(2),
        totalImpressions,
        totalClicks,
        totalConversions,
        totalRevenue: totalRevenue.toFixed(2),
        ctr: ctr.toFixed(2),
        cpc: cpc.toFixed(2),
        cpa: cpa.toFixed(2),
        roi: roi.toFixed(2),
        conversionRate: conversionRate.toFixed(2)
    };
}

/**
 * Group data by platform
 */
function groupByPlatform(data) {
    const platformMap = new Map();

    for (const item of data) {
        const platform = item.platform || 'Unknown';
        if (!platformMap.has(platform)) {
            platformMap.set(platform, []);
        }
        platformMap.get(platform).push(item);
    }

    const result = [];
    for (const [platform, items] of platformMap.entries()) {
        const metrics = calculateMetrics(items);
        result.push({
            platform,
            ...metrics
        });
    }

    return result.sort((a, b) => parseFloat(b.totalSpend) - parseFloat(a.totalSpend));
}

/**
 * Group data by date for time series
 */
function groupByDate(data) {
    const dateMap = new Map();

    for (const item of data) {
        const dateStr = item.date instanceof Date
            ? item.date.toISOString().split('T')[0]
            : String(item.date).split('T')[0];

        if (!dateMap.has(dateStr)) {
            dateMap.set(dateStr, []);
        }
        dateMap.get(dateStr).push(item);
    }

    const result = [];
    for (const [date, items] of dateMap.entries()) {
        const metrics = calculateMetrics(items);
        result.push({
            date,
            ...metrics
        });
    }

    return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculate week-over-week change percentage
 */
function calculateWoWChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return (((current - previous) / previous) * 100).toFixed(1);
}

/**
 * Generate placeholder data for development
 * This simulates real data structure until actual data sources are connected
 */
function generatePlaceholderData(startDate, endDate, comparisonStartDate, comparisonEndDate) {
    // Generate daily data for current period
    const currentPeriodData = generateDailyData(startDate, endDate, 'current');
    const comparisonPeriodData = generateDailyData(comparisonStartDate, comparisonEndDate, 'comparison');

    // Calculate totals for both periods
    const currentMetrics = calculatePeriodMetrics(currentPeriodData);
    const comparisonMetrics = calculatePeriodMetrics(comparisonPeriodData);

    // Calculate WoW changes
    const wowChanges = {
        impressions: calculateWoWChange(currentMetrics.impressions, comparisonMetrics.impressions),
        clicks: calculateWoWChange(currentMetrics.clicks, comparisonMetrics.clicks),
        cost: calculateWoWChange(currentMetrics.cost, comparisonMetrics.cost),
        leads: calculateWoWChange(currentMetrics.leads, comparisonMetrics.leads),
        cvr: calculateWoWChange(currentMetrics.cvr, comparisonMetrics.cvr),
        cpa: calculateWoWChange(currentMetrics.cpa, comparisonMetrics.cpa)
    };

    return {
        currentPeriod: {
            startDate,
            endDate,
            metrics: currentMetrics,
            dailyData: currentPeriodData
        },
        comparisonPeriod: {
            startDate: comparisonStartDate,
            endDate: comparisonEndDate,
            metrics: comparisonMetrics
        },
        wowChanges,
        campaignBreakdown: {
            interviews: generateCampaignMetrics('interviews', currentPeriodData, comparisonPeriodData),
            contacts: generateCampaignMetrics('contacts', currentPeriodData, comparisonPeriodData),
            general: generateCampaignMetrics('general', currentPeriodData, comparisonPeriodData)
        },
        studentMetrics: generateStudentMetrics()
    };
}

function generateDailyData(startDate, endDate, period) {
    const data = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        // Add some variability to make charts interesting
        const variance = period === 'current' ? 1.0 : 0.9;
        const dayFactor = Math.sin(data.length * 0.5) * 0.3 + 1;

        data.push({
            date: dateStr,
            impressions: Math.floor(1450 * variance * dayFactor),
            clicks: Math.floor(71 * variance * dayFactor),
            cost: parseFloat((1430 * variance * dayFactor).toFixed(2)),
            leads: Math.floor(4.3 * variance * dayFactor),
            conversions: Math.floor(4.3 * variance * dayFactor)
        });
    }

    return data;
}

function calculatePeriodMetrics(dailyData) {
    const impressions = dailyData.reduce((sum, d) => sum + d.impressions, 0);
    const clicks = dailyData.reduce((sum, d) => sum + d.clicks, 0);
    const cost = dailyData.reduce((sum, d) => sum + d.cost, 0);
    const interviews = dailyData.reduce((sum, d) => sum + (d.interviews || 0), 0);
    const contacts = dailyData.reduce((sum, d) => sum + (d.contacts || 0), 0);
    const leads = interviews + contacts; // Total leads = interviews + contacts
    const conversions = dailyData.reduce((sum, d) => sum + (d.conversions || 0), 0);

    const cvr = clicks > 0 ? ((leads / clicks) * 100) : 0;
    const cpa = leads > 0 ? (cost / leads) : 0;
    const cpi = interviews > 0 ? (cost / interviews) : 0; // Cost per interview
    const cpc_contact = contacts > 0 ? (cost / contacts) : 0; // Cost per contact

    return {
        impressions,
        clicks,
        cost: parseFloat(cost.toFixed(2)),
        interviews,
        contacts,
        leads, // Total leads
        conversions,
        cvr: parseFloat(cvr.toFixed(2)),
        cpa: parseFloat(cpa.toFixed(2)),
        cpi: parseFloat(cpi.toFixed(2)),
        cpc_contact: parseFloat(cpc_contact.toFixed(2))
    };
}

/**
 * Generate metrics for a specific conversion type
 * Uses ALL campaign data for impressions/clicks/cost
 * But only counts specific conversion type for leads/CPA
 */
function generateConversionTypeMetrics(conversionType, currentData, comparisonData) {
    // Calculate metrics based on conversion type
    const currentMetrics = calculateMetricsByConversionType(currentData, conversionType);
    const comparisonMetrics = calculateMetricsByConversionType(comparisonData, conversionType);

    const wowChanges = {
        cost: calculateWoWChange(currentMetrics.cost, comparisonMetrics.cost),
        leads: calculateWoWChange(currentMetrics.leads, comparisonMetrics.leads),
        cvr: calculateWoWChange(currentMetrics.cvr, comparisonMetrics.cvr),
        cpa: calculateWoWChange(currentMetrics.cpa, comparisonMetrics.cpa)
    };

    // Generate daily chart data for BOTH current and comparison periods
    const currentDailyData = currentData.map(d => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date).split('T')[0],
        metric1: conversionType === 'general' ? (d.interviews || 0) + (d.contacts || 0) :
                 conversionType === 'interviews' ? (d.interviews || 0) : (d.contacts || 0),
        metric2: d.clicks || 0
    }));

    const comparisonDailyData = comparisonData.map(d => ({
        date: d.date instanceof Date ? d.date.toISOString().split('T')[0] : String(d.date).split('T')[0],
        metric1: conversionType === 'general' ? (d.interviews || 0) + (d.contacts || 0) :
                 conversionType === 'interviews' ? (d.interviews || 0) : (d.contacts || 0),
        metric2: d.clicks || 0
    }));

    return {
        current: currentMetrics,
        comparison: comparisonMetrics,
        wowChanges,
        dailyData: {
            current: currentDailyData,
            comparison: comparisonDailyData
        }
    };
}

/**
 * Calculate metrics for a specific conversion type
 * Cost is allocated proportionally based on conversion share
 * e.g., if 70% of conversions were interviews, interviews get 70% of cost
 */
function calculateMetricsByConversionType(dailyData, conversionType) {
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalCost = 0;
    let leads = 0;

    // Calculate totals and allocate cost based on conversion share
    dailyData.forEach(d => {
        const dayInterviews = d.interviews || 0;
        const dayContacts = d.contacts || 0;
        const dayTotalConversions = dayInterviews + dayContacts;
        const dayCost = d.cost || 0;

        if (conversionType === 'general') {
            // General = all data, all conversions
            totalImpressions += d.impressions || 0;
            totalClicks += d.clicks || 0;
            totalCost += dayCost;
            leads += dayTotalConversions;
        } else if (conversionType === 'interviews') {
            // Allocate cost proportionally to interview conversions
            totalImpressions += d.impressions || 0;
            totalClicks += d.clicks || 0;
            if (dayTotalConversions > 0) {
                totalCost += dayCost * (dayInterviews / dayTotalConversions);
            }
            leads += dayInterviews;
        } else if (conversionType === 'contacts') {
            // Allocate cost proportionally to contact conversions
            totalImpressions += d.impressions || 0;
            totalClicks += d.clicks || 0;
            if (dayTotalConversions > 0) {
                totalCost += dayCost * (dayContacts / dayTotalConversions);
            }
            leads += dayContacts;
        }
    });

    const cvr = totalClicks > 0 ? ((leads / totalClicks) * 100) : 0;
    const cpa = leads > 0 ? (totalCost / leads) : 0;

    return {
        impressions: totalImpressions,
        clicks: totalClicks,
        cost: parseFloat(totalCost.toFixed(2)),
        leads,
        cvr: parseFloat(cvr.toFixed(2)),
        cpa: parseFloat(cpa.toFixed(2))
    };
}

function generateCampaignMetrics(campaignType, currentData, comparisonData) {
    // Split data by campaign type (roughly 1/3 each)
    const factor = campaignType === 'interviews' ? 0.35 : campaignType === 'contacts' ? 0.35 : 0.30;

    const currentMetrics = calculatePeriodMetrics(currentData.map(d => ({
        ...d,
        impressions: Math.floor(d.impressions * factor),
        clicks: Math.floor(d.clicks * factor),
        cost: d.cost * factor,
        leads: Math.floor(d.leads * factor),
        conversions: Math.floor(d.conversions * factor)
    })));

    const comparisonMetrics = calculatePeriodMetrics(comparisonData.map(d => ({
        ...d,
        impressions: Math.floor(d.impressions * factor),
        clicks: Math.floor(d.clicks * factor),
        cost: d.cost * factor,
        leads: Math.floor(d.leads * factor),
        conversions: Math.floor(d.conversions * factor)
    })));

    return {
        current: currentMetrics,
        comparison: comparisonMetrics,
        wowChanges: {
            cost: calculateWoWChange(currentMetrics.cost, comparisonMetrics.cost),
            leads: calculateWoWChange(currentMetrics.leads, comparisonMetrics.leads),
            cvr: calculateWoWChange(currentMetrics.cvr, comparisonMetrics.cvr),
            cpa: calculateWoWChange(currentMetrics.cpa, comparisonMetrics.cpa)
        },
        // Generate daily chart data for BOTH current and comparison periods
        dailyData: {
            current: currentData.map(d => ({
                date: d.date,
                metric1: Math.floor(d.clicks * factor * 0.8),
                metric2: Math.floor(d.conversions * factor * 1.2)
            })),
            comparison: comparisonData.map(d => ({
                date: d.date,
                metric1: Math.floor(d.clicks * factor * 0.7), // Slightly different for comparison
                metric2: Math.floor(d.conversions * factor * 1.1)
            }))
        }
    };
}

function generateStudentMetrics() {
    return {
        foundationsStarted: { value: 10, wowChange: 9 },
        enrollments: { value: 3, wowChange: 9 },
        enrollmentRevenue: { value: 98000, wowChange: 9 },
        roas: { value: 4.35, wowChange: 9 },
        graduates: { value: 1, yoyChange: 9 },
        graduationRate: { value: 75, yoyChange: 9 },
        jobsPlaced: { value: 1, yoyChange: 9 },
        jobPlacementRate: { value: 50, yoyChange: 9 }
    };
}

exports.handler = async (event) => {
    const corsHeaders = getCorsHeaders('GET,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Require admin authentication
    const authError = requireAdmin(event, corsHeaders);
    if (authError) {
        return authError;
    }

    try {
        const q = event.queryStringParameters || {};
        const usePlaceholder = q.usePlaceholder === 'true' || q.usePlaceholder === '1';

        // Parse date ranges from query params
        const startDate = q.startDate || '2025-10-27';
        const endDate = q.endDate || '2025-11-02';
        const comparisonStartDate = q.comparisonStartDate || '2025-10-13';
        const comparisonEndDate = q.comparisonEndDate || '2025-10-19';

        // Connect to database
        const db = await getDb();
        await createAdSpendIndexes(db);
        const coll = db.collection('ad_spend');
        const recordCount = await coll.countDocuments();

        // If no data in database, return empty state
        if (recordCount === 0) {
            return {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                },
                body: JSON.stringify({
                    currentPeriod: {
                        startDate,
                        endDate,
                        metrics: {
                            impressions: 0,
                            clicks: 0,
                            cost: 0,
                            leads: 0,
                            cvr: 0,
                            cpa: 0
                        },
                        dailyData: []
                    },
                    comparisonPeriod: {
                        startDate: comparisonStartDate,
                        endDate: comparisonEndDate,
                        metrics: {
                            impressions: 0,
                            clicks: 0,
                            cost: 0,
                            leads: 0,
                            cvr: 0,
                            cpa: 0
                        }
                    },
                    wowChanges: {
                        impressions: 0,
                        clicks: 0,
                        cost: 0,
                        leads: 0,
                        cvr: 0,
                        cpa: 0
                    },
                    campaignBreakdown: {
                        general: { current: { cost: 0, leads: 0, cvr: 0, cpa: 0 }, wowChanges: {}, dailyData: { current: [], comparison: [] } },
                        interviews: { current: { cost: 0, leads: 0, cvr: 0, cpa: 0 }, wowChanges: {}, dailyData: { current: [], comparison: [] } },
                        contacts: { current: { cost: 0, leads: 0, cvr: 0, cpa: 0 }, wowChanges: {}, dailyData: { current: [], comparison: [] } }
                    },
                    studentMetrics: {
                        foundationsStarted: { value: 0, wowChange: 0 },
                        enrollments: { value: 0, wowChange: 0 },
                        enrollmentRevenue: { value: 0, wowChange: 0 },
                        roas: { value: 0, wowChange: 0 },
                        graduates: { value: 0, yoyChange: 0 },
                        graduationRate: { value: 0, yoyChange: 0 },
                        jobsPlaced: { value: 0, yoyChange: 0 },
                        jobPlacementRate: { value: 0, yoyChange: 0 }
                    },
                    noData: true,
                    message: 'No ad spend data found. Please sync data from Google Ads first.'
                })
            };
        }

        // Use real data from database
        const platform = q.platform || null;
        const campaign = q.campaign || null;

        // Build query filter with proper date range (inclusive of full days)
        // Set start to beginning of day, end to end of day
        const queryStartDate = new Date(comparisonStartDate);
        queryStartDate.setUTCHours(0, 0, 0, 0);

        const queryEndDate = new Date(endDate);
        queryEndDate.setUTCHours(23, 59, 59, 999);

        const filter = {
            date: {
                $gte: queryStartDate,
                $lte: queryEndDate
            }
        };

        if (platform) {
            filter.platform = platform;
        }

        if (campaign) {
            filter.campaign = campaign;
        }

        // Fetch ad spend data for both periods
        const allData = await coll
            .find(filter)
            .sort({ date: 1 })
            .toArray();

        // Helper function to normalize dates for comparison (avoid timezone issues)
        const normalizeDateString = (date) => {
            if (!date) return '';
            if (date instanceof Date) {
                return date.toISOString().split('T')[0];
            }
            return String(date).split('T')[0];
        };

        // Split into current and comparison periods using string comparison
        const currentPeriodData = allData.filter(d => {
            const dateStr = normalizeDateString(d.date);
            return dateStr >= startDate && dateStr <= endDate;
        });

        const comparisonPeriodData = allData.filter(d => {
            const dateStr = normalizeDateString(d.date);
            return dateStr >= comparisonStartDate && dateStr <= comparisonEndDate;
        });

        // Calculate metrics for both periods
        const currentMetrics = calculatePeriodMetrics(currentPeriodData);
        const comparisonMetrics = calculatePeriodMetrics(comparisonPeriodData);

        // Calculate WoW changes
        const wowChanges = {
            impressions: calculateWoWChange(currentMetrics.impressions, comparisonMetrics.impressions),
            clicks: calculateWoWChange(currentMetrics.clicks, comparisonMetrics.clicks),
            cost: calculateWoWChange(currentMetrics.cost, comparisonMetrics.cost),
            interviews: calculateWoWChange(currentMetrics.interviews, comparisonMetrics.interviews),
            contacts: calculateWoWChange(currentMetrics.contacts, comparisonMetrics.contacts),
            leads: calculateWoWChange(currentMetrics.leads, comparisonMetrics.leads),
            cvr: calculateWoWChange(currentMetrics.cvr, comparisonMetrics.cvr),
            cpa: calculateWoWChange(currentMetrics.cpa, comparisonMetrics.cpa),
            cpi: calculateWoWChange(currentMetrics.cpi, comparisonMetrics.cpi),
            cpc_contact: calculateWoWChange(currentMetrics.cpc_contact, comparisonMetrics.cpc_contact)
        };

        // Calculate breakdowns by conversion type
        // All sections use the same campaign data (impressions/clicks/cost)
        // but show different conversion metrics
        const campaignBreakdown = {
            // Overall Performance: all impressions, clicks, cost, all conversions
            general: generateConversionTypeMetrics('general', currentPeriodData, comparisonPeriodData),
            // Interviews: same impressions/clicks/cost, but only interview conversions
            interviews: generateConversionTypeMetrics('interviews', currentPeriodData, comparisonPeriodData),
            // Contacts: same impressions/clicks/cost, but only contact conversions
            contacts: generateConversionTypeMetrics('contacts', currentPeriodData, comparisonPeriodData)
        };

        // Get student metrics from database or use placeholder
        // TODO: Connect to real student metrics source
        const studentMetrics = generateStudentMetrics();

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            },
            body: JSON.stringify({
                currentPeriod: {
                    startDate,
                    endDate,
                    metrics: currentMetrics,
                    dailyData: currentPeriodData
                },
                comparisonPeriod: {
                    startDate: comparisonStartDate,
                    endDate: comparisonEndDate,
                    metrics: comparisonMetrics
                },
                wowChanges,
                campaignBreakdown,
                studentMetrics,
                usingPlaceholderData: false
            })
        };
    } catch (e) {
        console.error('Ad spend dashboard error:', e);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Server error',
                message: e.message
            })
        };
    }
};
