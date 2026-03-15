/** A single topic available for practice */
export interface Topic {
  id: string;
  name: string;
  description?: string;
}

/** A word/phrase entry within a topic dataset */
export interface DatasetEntry {
  word: string;
  translation?: string;
  category?: string;
}

/** A full dataset for a topic */
export interface TopicDataset {
  topic: Topic;
  entries: DatasetEntry[];
}
