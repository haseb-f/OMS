import { BadRequestException } from '@nestjs/common';

export interface GoogleSheetsUrlParts {
  spreadsheetId: string;
  /** The sheet's numeric `gid` from the URL fragment/query, e.g. "123456" — `GoogleSheetsService` resolves this to the sheet's actual title via `spreadsheets.get()`. `undefined` when the URL didn't specify one (defaults to the first sheet). */
  gid: string | undefined;
}

/**
 * Parses any Google Sheets share/edit URL a user pastes
 * (`.../edit#gid=123`, `.../edit?usp=sharing`, an already-built export URL,
 * ...) into its spreadsheet ID and sheet gid. This is the only thing this
 * module still does with a raw URL — actually reading the sheet's data goes
 * through the authenticated `GoogleSheetsService` (Part 5), never a public
 * CSV export link.
 */
export function parseGoogleSheetsUrl(shareUrl: string): GoogleSheetsUrlParts {
  const idMatch = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new BadRequestException(
      'That does not look like a Google Sheets URL — expected something like https://docs.google.com/spreadsheets/d/<id>/edit',
    );
  }
  const gidMatch = shareUrl.match(/[#&?]gid=(\d+)/);
  return { spreadsheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : undefined };
}
