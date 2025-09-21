import { Octokit } from '@octokit/rest'

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
export async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

// Files and directories to ignore
const IGNORE_PATTERNS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.env',
  '.env.local',
  '.env.production',
  '.vscode',
  '.idea',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml'
];

async function walkDirectory(dirPath: string, basePath: string = ''): Promise<Array<{ path: string; content: string; isBase64: boolean }>> {
  const files: Array<{ path: string; content: string; isBase64: boolean }> = [];
  
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (IGNORE_PATTERNS.includes(entry.name)) {
        continue;
      }
      
      const fullPath = join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        const subFiles = await walkDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const fileStat = await stat(fullPath);
          // Skip files larger than 50MB
          if (fileStat.size > 50 * 1024 * 1024) {
            console.log(`Skipping large file: ${relativePath} (${fileStat.size} bytes)`);
            continue;
          }
          
          // Determine if file is binary
          const buffer = await readFile(fullPath);
          const isBinary = buffer.includes(0) || buffer.length === 0;
          
          files.push({
            path: relativePath,
            content: isBinary ? buffer.toString('base64') : buffer.toString('utf-8'),
            isBase64: isBinary
          });
        } catch (err) {
          console.warn(`Error reading file ${relativePath}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn(`Error reading directory ${dirPath}:`, err);
  }
  
  return files;
}

export async function pushToGitHub(commitMessage: string = 'Update files', branch: string = 'main', owner?: string, repo?: string) {
  try {
    const octokit = await getUncachableGitHubClient();
    
    // Get current user
    const { data: user } = await octokit.rest.users.getAuthenticated();
    console.log('GitHub user:', user.login);
    
    // Parse repository info from remote origin or use provided values
    // Default to authenticated user if no owner provided
    const targetOwner = owner || user.login; 
    const targetRepo = repo || 'network';
    
    console.log(`Pushing to ${targetOwner}/${targetRepo} on branch ${branch}`);
    
    // Check if repository exists, create if not
    try {
      await octokit.rest.repos.get({
        owner: targetOwner,
        repo: targetRepo
      });
    } catch (error: any) {
      if (error.status === 404) {
        console.log('Repository does not exist, creating it...');
        await octokit.rest.repos.createForAuthenticatedUser({
          name: targetRepo,
          private: false,
          description: 'Network diagram visualization application',
          auto_init: false
        });
        console.log('Repository created successfully');
      } else {
        throw error;
      }
    }
    
    // Get current reference
    let currentRef;
    try {
      const { data: ref } = await octokit.rest.git.getRef({
        owner: targetOwner,
        repo: targetRepo,
        ref: `heads/${branch}`
      });
      currentRef = ref;
    } catch (error: any) {
      if (error.status === 404 || error.status === 409) {
        // Branch doesn't exist or repository is empty, we'll create it
        console.log(`Branch ${branch} doesn't exist or repository is empty, will create it`);
        currentRef = null;
      } else {
        throw error;
      }
    }
    
    // Get base tree if we have a current commit
    let baseTree = null;
    if (currentRef) {
      const { data: commit } = await octokit.rest.git.getCommit({
        owner: targetOwner,
        repo: targetRepo,
        commit_sha: currentRef.object.sha
      });
      baseTree = commit.tree.sha;
    }
    
    // Walk project directory and collect all files
    const projectPath = process.cwd();
    console.log('Collecting files from:', projectPath);
    const files = await walkDirectory(projectPath);
    console.log(`Found ${files.length} files to upload`);
    
    // Create blobs for all files
    const treeEntries = [];
    for (const file of files) {
      console.log(`Creating blob for ${file.path}`);
      const { data: blob } = await octokit.rest.git.createBlob({
        owner: targetOwner,
        repo: targetRepo,
        content: file.content,
        encoding: file.isBase64 ? 'base64' : 'utf-8'
      });
      
      treeEntries.push({
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha
      });
    }
    
    // Create tree
    console.log('Creating tree...');
    const { data: tree } = await octokit.rest.git.createTree({
      owner: targetOwner,
      repo: targetRepo,
      tree: treeEntries,
      base_tree: baseTree || undefined
    });
    
    // Create commit
    console.log('Creating commit...');
    const { data: commit } = await octokit.rest.git.createCommit({
      owner: targetOwner,
      repo: targetRepo,
      message: commitMessage,
      tree: tree.sha,
      parents: currentRef ? [currentRef.object.sha] : []
    });
    
    // Update reference or create if it doesn't exist
    if (currentRef) {
      console.log('Updating reference...');
      await octokit.rest.git.updateRef({
        owner: targetOwner,
        repo: targetRepo,
        ref: `heads/${branch}`,
        sha: commit.sha
      });
    } else {
      console.log('Creating reference...');
      await octokit.rest.git.createRef({
        owner: targetOwner,
        repo: targetRepo,
        ref: `refs/heads/${branch}`,
        sha: commit.sha
      });
    }
    
    console.log('Push completed successfully!');
    return {
      success: true,
      user: user.login,
      commitSha: commit.sha,
      commitUrl: `https://github.com/${targetOwner}/${targetRepo}/commit/${commit.sha}`,
      filesUploaded: files.length
    };
    
  } catch (error) {
    console.error('GitHub push error:', error);
    throw error;
  }
}