import { SystemConfigStore } from './store.js';

/**
 * Convert 24-hour integer (0-24) to human-readable AM/PM string
 * e.g., 0 -> "12:00 AM", 8 -> "8:00 AM", 12 -> "12:00 PM", 20 -> "8:00 PM", 24 -> "12:00 AM"
 */
export function formatHourAmPm(hour) {
  const h = parseInt(hour, 10);
  if (isNaN(h)) return '12:00 AM';
  if (h === 0 || h === 24) return '12:00 AM (Midnight)';
  if (h === 12) return '12:00 PM (Noon)';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

/**
 * Real-time Operational Hours Guard
 * Evaluates whether current outbound actions (calls, emails, SMS) are authorized.
 * @param {string|null} timezone - Optional IANA timezone string (e.g. 'America/New_York', 'UTC')
 * @returns {Promise<{ allowed: boolean, currentHour: number, startHour: number, endHour: number, startFormatted: string, endFormatted: string, message: string }>}
 */
export async function checkOperationalHours(timezone = null) {
  const config = await SystemConfigStore.getConfig();
  const startHour = config.allowedHoursStart !== undefined && config.allowedHoursStart !== null ? parseInt(config.allowedHoursStart, 10) : 0;
  const endHour = config.allowedHoursEnd !== undefined && config.allowedHoursEnd !== null ? parseInt(config.allowedHoursEnd, 10) : 24;

  let currentHour = new Date().getHours();
  let activeTimezone = 'Server Local / System Time';

  if (timezone && typeof timezone === 'string' && timezone.trim() !== '') {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone.trim(),
        hour: 'numeric',
        hour12: false
      });
      const parts = formatter.format(new Date());
      const parsed = parseInt(parts, 10);
      if (!isNaN(parsed)) {
        currentHour = parsed === 24 ? 0 : parsed;
        activeTimezone = timezone.trim();
      }
    } catch (e) {
      // Fallback to server local time
    }
  }

  // If startHour === 0 && endHour === 24 (or startHour === endHour), 24/7 full access
  let allowed = true;
  if ((startHour === 0 && endHour === 24) || startHour === endHour) {
    allowed = true;
  } else if (startHour < endHour) {
    // Standard daytime window, e.g. 8 (8 AM) to 20 (8 PM)
    allowed = currentHour >= startHour && currentHour < endHour;
  } else {
    // Overnight window, e.g. 20 (8 PM) to 6 (6 AM)
    allowed = currentHour >= startHour || currentHour < endHour;
  }

  const startFormatted = formatHourAmPm(startHour);
  const endFormatted = formatHourAmPm(endHour);
  const currentFormatted = formatHourAmPm(currentHour);

  return {
    allowed,
    currentHour,
    startHour,
    endHour,
    activeTimezone,
    startFormatted,
    endFormatted,
    currentFormatted,
    message: allowed
      ? `Within authorized operational hours (${startFormatted} - ${endFormatted})`
      : `Action restricted outside authorized operational hours (${startFormatted} - ${endFormatted}). Current time in ${activeTimezone} is ${currentFormatted}.`
  };
}
