import { BadRequestException } from '@nestjs/common';

/**
 * Google Sheets URL Source (Phase 1) — accepts any share/edit URL a user
 * pastes (`.../edit#gid=123`, `.../edit?usp=sharing`, or an already-built
 * export URL) and turns it into the sheet's public CSV export URL. No
 * Google API/OAuth involved — this only works for sheets shared as
 * "Anyone with the link can view," same constraint as pasting the URL into
 * a browser directly.
 */
export function toGoogleSheetsCsvExportUrl(shareUrl: string): string {
  const idMatch = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new BadRequestException(
      'That does not look like a Google Sheets URL — expected something like https://docs.google.com/spreadsheets/d/<id>/edit',
    );
  }
  const sheetId = idMatch[1];
  const gidMatch = shareUrl.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/** Fetches the sheet's current contents as CSV text — the same shape `parseCsv` already expects, no separate parser. */
export async function fetchGoogleSheetCsv(shareUrl: string): Promise<string> {
  const exportUrl = toGoogleSheetsCsvExportUrl(shareUrl);
  let response: Response;
  try {
    response = await fetch(exportUrl);
  } catch {
    throw new BadRequestException(
      'Could not reach Google Sheets — check the URL and your connection.',
    );
  }
  if (!response.ok) {
    throw new BadRequestException(
      `Could not read that Google Sheet (HTTP ${response.status}) — make sure it is shared as "Anyone with the link can view."`,
    );
  }
  return response.text();
}
