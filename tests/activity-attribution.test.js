import test from 'node:test';
import assert from 'node:assert/strict';

test('User-Level Activity & Communication History Attribution', async (t) => {
    await t.test('formats CSV export correctly with all required headers and columns', () => {
        const headers = [
            'Date/Time (UTC)',
            'Salesperson',
            'Salesperson Email',
            'Lead Name',
            'Lead Company',
            'Lead Phone',
            'Lead Email',
            'Channel',
            'Action',
            'Status',
            'Result / Duration',
            'Details / Notes',
            'Activity ID',
            'Call SID / Message ID'
        ];

        const sampleRows = [
            [
                '2026-09-16 10:32:00',
                'Sarah Connor',
                'sarah@8020acquisition.com',
                'John Smith',
                'ABC Ltd',
                '+15551234567',
                'john@abcltd.com',
                'Call',
                'Outbound Call',
                'Connected',
                '04:32',
                'Lead requested follow up demo next Tuesday',
                'act_12345',
                'CA1234567890abcdef'
            ]
        ];

        const escapeCsv = (str) => {
            if (str === null || str === undefined) return '""';
            const s = String(str).replace(/"/g, '""');
            return `"${s}"`;
        };

        const csvContent = [
            headers.map(escapeCsv).join(','),
            ...sampleRows.map(row => row.map(escapeCsv).join(','))
        ].join('\n');

        assert.ok(csvContent.includes('"Salesperson"'));
        assert.ok(csvContent.includes('"Sarah Connor"'));
        assert.ok(csvContent.includes('"04:32"'));
        assert.ok(csvContent.includes('"CA1234567890abcdef"'));
        assert.strictEqual(csvContent.split('\n').length, 2);
    });

    await t.test('calculates date ranges properly without losing time precision', () => {
        const now = new Date();
        
        // UTC Today start
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        assert.strictEqual(todayStart.getUTCHours(), 0);
        assert.strictEqual(todayStart.getUTCMinutes(), 0);
        assert.strictEqual(todayEnd.getUTCHours(), 23);
        assert.strictEqual(todayEnd.getUTCMinutes(), 59);

        // 7 days start
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
        assert.ok(sevenDaysAgo.getTime() < now.getTime());
    });

    await t.test('formats duration seconds into mm:ss and hh:mm:ss accurately', () => {
        const formatDuration = (seconds) => {
            if (!seconds || seconds <= 0) return '00:00';
            const s = Math.floor(seconds);
            const hrs = Math.floor(s / 3600);
            const mins = Math.floor((s % 3600) / 60);
            const secs = s % 60;
            if (hrs > 0) {
                return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            }
            return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        };

        assert.strictEqual(formatDuration(0), '00:00');
        assert.strictEqual(formatDuration(45), '00:45');
        assert.strictEqual(formatDuration(272), '04:32');
        assert.strictEqual(formatDuration(3665), '01:01:05');
    });

    await t.test('resolves lead and salesperson names correctly with fallback to Unknown/System', () => {
        const userMap = {
            'user-1': { name: 'Sarah Connor', email: 'sarah@8020acquisition.com' },
            'user-2': { name: 'Mike Ross', email: 'mike@8020acquisition.com' },
        };

        const leadMap = {
            'lead-1': { name: 'John Smith', company: 'ABC Ltd', phone: '+15551234567', email: 'john@abcltd.com' }
        };

        const resolveLog = (log) => {
            const user = userMap[log.userId] || { name: 'System / Automated', email: '' };
            const lead = leadMap[log.leadId] || { name: 'Unknown Lead', company: '—', phone: '—', email: '—' };
            return {
                userName: user.name,
                userEmail: user.email,
                leadName: lead.name,
                leadCompany: lead.company
            };
        };

        const resolvedWithUser = resolveLog({ userId: 'user-1', leadId: 'lead-1' });
        assert.strictEqual(resolvedWithUser.userName, 'Sarah Connor');
        assert.strictEqual(resolvedWithUser.leadName, 'John Smith');

        const resolvedWithoutUser = resolveLog({ userId: 'user-unknown', leadId: 'lead-unknown' });
        assert.strictEqual(resolvedWithoutUser.userName, 'System / Automated');
        assert.strictEqual(resolvedWithoutUser.leadName, 'Unknown Lead');
    });
});
