import type { Topic, TopicDataset } from "./types.js";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const foodData = require("./datasets/food.json") as TopicDataset;
const travelData = require("./datasets/travel.json") as TopicDataset;
const itTermsData = require("./datasets/it-terms.json") as TopicDataset;

const datasets: TopicDataset[] = [foodData, travelData, itTermsData];

/** Pure business-logic service for managing topics and datasets */
export class TopicService {
  /** Get all available topics */
  getTopics(): Topic[] {
    return datasets.map((d) => d.topic);
  }

  /** Get a dataset by topic ID */
  getDataset(topicId: string): TopicDataset | undefined {
    return datasets.find((d) => d.topic.id === topicId);
  }
}
