# 🚀 Push to GitHub - Instructions

## Step 1: Create Repository on GitHub

1. Go to https://github.com/new
2. Repository name: `lobstermind-memory`
3. Description: "Long-term memory plugin for OpenClaw with SQLite storage, semantic search, and Obsidian sync"
4. Visibility: Public (recommended) or Private
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

## Step 2: Link Local Repository to GitHub

### Option A: Using HTTPS (with Personal Access Token)

```bash
cd C:\Users\Paolozky\.openclaw\extensions\lobstermind-memory

# Add GitHub remote (replace with your repo URL)
git remote add origin https://github.com/pnll1991/lobstermind-memory.git

# Push to GitHub
git push -u origin master
```

**Note:** If you have 2FA enabled on GitHub, you'll need to use a Personal Access Token instead of your password.

Create a token at: https://github.com/settings/tokens
- Select scopes: `repo` (full control of private repositories)
- Use the token as your password when pushing

### Option B: Using SSH (Recommended)

```bash
cd C:\Users\Paolozky\.openclaw\extensions\lobstermind-memory

# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "your_email@example.com"

# Add SSH key to GitHub
# 1. Copy the public key
type $env:USERPROFILE\.ssh\id_ed25519.pub
# (On macOS/Linux: cat ~/.ssh/id_ed25519.pub)

# 2. Go to https://github.com/settings/keys
# 3. Click "New SSH key"
# 4. Paste your public key and save

# Add GitHub remote
git remote add origin git@github.com:pnll1991/lobstermind-memory.git

# Push to GitHub
git push -u origin master
```

## Step 3: Verify Upload

1. Go to https://github.com/pnll1991/lobstermind-memory
2. Verify all files are present:
   - ✅ README.md
   - ✅ LICENSE
   - ✅ index.ts
   - ✅ package.json
   - ✅ openclaw.plugin.json
   - ✅ install.sh
   - ✅ install.ps1
   - ✅ .gitignore

## Step 4: Create First Release (Optional but Recommended)

1. Go to https://github.com/pnll1991/lobstermind-memory/releases/new
2. Tag version: `v1.0.0`
3. Release title: `v1.0.0 - Initial Release`
4. Description:
   ```
   ## 🎉 First Release!

   ### Features
   - SQLite storage for long-term memory
   - Semantic search with DashScope embeddings
   - Automatic Obsidian vault sync
   - CLI commands (--list, --add, --search)
   - Memory note tag capture
   - Cross-platform support (Windows, macOS, Linux)

   ### Installation
   ```bash
   # Windows (PowerShell)
   iwr https://raw.githubusercontent.com/pnll1991/lobstermind-memory/main/install.ps1 -useb | iex

   # macOS/Linux (Bash)
   curl -fsSL https://raw.githubusercontent.com/pnll1991/lobstermind-memory/main/install.sh | bash
   ```

   ### Documentation
   See README.md for full usage instructions.
   ```
5. Click "Publish release"

## Step 5: Test Installation

After pushing, test the installation scripts:

### Windows
```powershell
iwr https://raw.githubusercontent.com/pnll1991/lobstermind-memory/main/install.ps1 -useb | iex
```

### macOS/Linux
```bash
curl -fsSL https://raw.githubusercontent.com/pnll1991/lobstermind-memory/main/install.sh | bash
```

## Common Issues

### Permission Denied (HTTPS)
```
remote: Invalid username or password.
```
**Solution:** Use Personal Access Token instead of password, or switch to SSH.

### Permission Denied (SSH)
```
git@github.com: Permission denied (publickey).
```
**Solution:** 
1. Ensure SSH key is added to GitHub
2. Test SSH: `ssh -T git@github.com`
3. Make sure SSH agent is running: `ssh-add ~/.ssh/id_ed25519`

### Remote Already Exists
```
fatal: remote origin already exists.
```
**Solution:** 
```bash
git remote remove origin
git remote add origin <your-repo-url>
```

## Need Help?

- GitHub Docs: https://docs.github.com/en/get-started/getting-started-with-git
- SSH Setup: https://docs.github.com/en/authentication/connecting-to-github-with-ssh
- Personal Access Tokens: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
