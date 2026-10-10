// One import surface for templates; everything here is inside the shell manifest's domain closure.
export { categoryName, formatPrice, itemName, tr, weekdayLabel } from "@/src/domain/format";
export { ALLERGENS, allergenName } from "@/src/domain/allergens";
export { isSoldOut, liveAnnouncements, visibleItems } from "@/src/domain/effective";
export { todayStatus } from "@/src/domain/hours";
export { formatDate, formatDateTime, hhmm, localDate, localTime, localWeekday } from "@/src/time";
