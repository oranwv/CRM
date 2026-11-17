// Guest count can be a range ("100-120"): `guest_count` holds the lower number (what every
// calculation uses) and `guest_count_max` the upper one, when there is one (Phase 89).
export function fmtGuests(lead) {
  if (!lead?.guest_count) return '';
  return lead.guest_count_max ? `${lead.guest_count}-${lead.guest_count_max}` : String(lead.guest_count);
}
