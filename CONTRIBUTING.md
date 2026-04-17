# Contributing to AniList Stremio Addon

Thank you for your interest in contributing to the AniList Stremio Addon! This document provides guidelines and instructions for contributing to the project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow:

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Respect differing viewpoints and experiences

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/anilist-stremio-addon.git
   cd anilist-stremio-addon
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/original-owner/anilist-stremio-addon.git
   ```

## Development Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create `.env` file**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your AniList username.

3. **Start development server**:
   ```bash
   npm run dev
   ```

## Project Structure

```
anilist-stremio-addon/
├── config/              # Configuration files
│   ├── constants.js     # Application constants
│   └── env.js          # Environment variable handling
├── services/           # External service integrations
│   └── anilist.js      # AniList API service
├── addon.js            # Stremio addon interface
├── index.js            # Express server
└── package.json        # Dependencies and scripts
```

### Key Files

- **`index.js`**: HTTP server and route handlers
- **`addon.js`**: Stremio addon manifest and handlers
- **`services/anilist.js`**: AniList API integration
- **`config/constants.js`**: Centralized constants
- **`config/env.js`**: Environment configuration

## Coding Standards

### JavaScript Style

- Use **ES6+ features** (const/let, arrow functions, async/await)
- Use **2 spaces** for indentation
- Use **single quotes** for strings
- Add **semicolons** at the end of statements
- Keep lines under **100 characters** when possible

### Documentation

All functions must include JSDoc comments:

```javascript
/**
 * Brief description of the function
 * 
 * Detailed explanation of what the function does,
 * including any important behavior or side effects.
 * 
 * @async
 * @param {string} paramName - Description of parameter
 * @param {Object} options - Options object
 * @param {string} options.key - Description of option
 * @returns {Promise<Object>} Description of return value
 * @throws {Error} When something goes wrong
 * 
 * @example
 * const result = await myFunction('value', { key: 'option' });
 */
async function myFunction(paramName, options) {
  // Implementation
}
```

### Code Organization

1. **Imports** at the top
2. **Constants** after imports
3. **Helper functions** before main functions
4. **Main functions** in logical order
5. **Exports** at the bottom

### Error Handling

- Always use try-catch for async operations
- Provide meaningful error messages
- Log errors with context
- Don't expose sensitive information in errors

Example:
```javascript
try {
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  console.error('Error in someAsyncOperation:', error.message);
  throw new Error(`Failed to complete operation: ${error.message}`);
}
```

### Comments

- Use comments to explain **why**, not **what**
- Add comments for complex logic
- Keep comments up-to-date with code changes
- Use TODO comments for future improvements:
  ```javascript
  // TODO: Implement caching for API responses
  ```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-catalog` - New features
- `fix/api-error-handling` - Bug fixes
- `docs/update-readme` - Documentation updates
- `refactor/improve-error-messages` - Code refactoring

### Commit Messages

Write clear, descriptive commit messages:

```
feat: add support for completed anime catalog

- Add new catalog for completed anime
- Update constants with new catalog definition
- Add tests for completed anime fetching
```

Format:
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

### Development Workflow

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Write code following the coding standards
   - Add JSDoc comments
   - Update documentation if needed

3. **Test your changes**:
   - Run the server: `npm run dev`
   - Test in Stremio
   - Verify error handling

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature"
   ```

5. **Keep your branch updated**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

6. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Testing

### Manual Testing

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Test endpoints**:
   - Visit `http://localhost:3000/manifest.json`
   - Test catalog: `http://localhost:3000/catalog/anime/anilist.watching.json`

3. **Test in Stremio**:
   - Install addon in Stremio
   - Verify catalog appears
   - Check anime metadata displays correctly

### Testing Checklist

- [ ] Server starts without errors
- [ ] Manifest loads correctly
- [ ] Catalog fetches anime successfully
- [ ] Error handling works (try invalid username)
- [ ] Addon installs in Stremio
- [ ] Anime display correctly in Stremio

## Submitting Changes

### Pull Request Process

1. **Update documentation**:
   - Update README.md if needed
   - Add JSDoc comments
   - Update CONTRIBUTING.md if workflow changes

2. **Create Pull Request**:
   - Go to your fork on GitHub
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template

3. **PR Description should include**:
   - What changes were made
   - Why the changes were needed
   - How to test the changes
   - Screenshots (if UI changes)
   - Related issues (if any)

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactoring

## Testing
How to test these changes:
1. Step one
2. Step two

## Checklist
- [ ] Code follows project style guidelines
- [ ] Added/updated JSDoc comments
- [ ] Updated documentation
- [ ] Tested manually
- [ ] No console errors
```

## Reporting Issues

### Before Creating an Issue

1. **Search existing issues** to avoid duplicates
2. **Try the latest version** of the code
3. **Gather information**:
   - Node.js version
   - Operating system
   - Error messages
   - Steps to reproduce

### Issue Template

```markdown
## Description
Clear description of the issue

## Steps to Reproduce
1. Step one
2. Step two
3. Expected behavior
4. Actual behavior

## Environment
- Node.js version: 
- OS: 
- AniList username visibility: Public/Private

## Error Messages
```
Paste error messages here
```

## Additional Context
Any other relevant information
```

## Feature Requests

We welcome feature requests! Please include:

1. **Use case**: Why is this feature needed?
2. **Proposed solution**: How should it work?
3. **Alternatives**: Other ways to achieve the goal
4. **Additional context**: Screenshots, examples, etc.

## Questions?

If you have questions about contributing:

1. Check existing documentation
2. Search closed issues
3. Open a new issue with the "question" label

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

Thank you for contributing! 🎉