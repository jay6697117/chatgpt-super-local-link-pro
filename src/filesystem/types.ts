export interface DirectoryTreeOptions {
  depth?: number;
  maxEntries?: number;
  excludePatterns?: string[];
}

export interface ReadFileOptions {
  maxBytes?: number;
}

export interface ReadManyOptions {
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export interface SearchOptions {
  mode?: 'literal' | 'regex';
  includeGlob?: string;
  excludePatterns?: string[];
  caseSensitive?: boolean;
  maxFiles?: number;
  maxResults?: number;
}

export interface ProjectOverviewOptions {
  depth?: number;
  includePatterns?: string[];
  maxFiles?: number;
}
