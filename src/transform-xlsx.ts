import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { ChangeMetadata, GerritDataOutput } from './types';
import type { ChangeInfoId, ChangeId, NumericChangeId, ChangeStatus, Timestamp, AccountId } from '@gerritcodereview/typescript-api/rest-api';

// Paths
const INPUT_FILE = path.join(__dirname, '../../paper_data/Experiment_data.xlsx');
const OUTPUT_FILE = path.join(__dirname, '../../paper_data/transformed_data.json');

function main() {
  console.log(`Reading ${INPUT_FILE}...`);
  const workbook = xlsx.readFile(INPUT_FILE);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Parse rows as objects
  const rawData: any[] = xlsx.utils.sheet_to_json(sheet);
  
  console.log(`Loaded ${rawData.length} rows.`);

  const changes: ChangeMetadata[] = rawData.map((row, index) => {
    const change_id = String(row['Id'] || `I${Date.now()}${index}`) as unknown as ChangeId;
    const subject = String(row['Subject'] || 'No Subject');
    const commit_message = String(row['Message'] || '');
    // Need to handle Time
    const timeStr = String(row['Time'] || new Date().toISOString());
    // Format timestamp string if needed (Gerrit format: "yyyy-MM-dd HH:mm:ss.nnnnnnnnn")
    // If it's already an ISO string or similar, we'll just keep it or try to format
    const created = timeStr as unknown as Timestamp;

    const changeMeta: ChangeMetadata = {
      id: `unknown~main~${change_id}` as unknown as ChangeInfoId,
      change_id: change_id,
      _number: (index + 1) as unknown as NumericChangeId,
      status: 'NEW' as unknown as ChangeStatus,
      timestamps: {
        created: created,
        updated: created,
        submitted: null
      },
      accounts: {
        owner: {
          account_id: 1 as unknown as AccountId,
          name: "Unknown",
          display_name: null,
          email: null,
          username: null
        },
        submitter: null
      },
      subject: subject,
      commit_message: commit_message,
      change_log: {
        entry_count: 0,
        entries: []
      }
    };
    return changeMeta;
  });

  const output: GerritDataOutput = {
    collected_at: new Date().toISOString(),
    source_url: 'unknown',
    total_changes: changes.length,
    changes: changes
  };

  console.log(`Writing to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log('Done!');
}

main();
