const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const levenshtein = require('fast-levenshtein');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const readDatabase = () => {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'public', 'database.json'), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database.json:', error);
        return { query: [], title_course: [], course: [] };
    }
};

const saveDatabase = (data) => {
    fs.writeFileSync(path.join(__dirname, 'public', 'database.json'), JSON.stringify(data, null, 2));
};

function cleanMarkdown(text) {
    return text.replace(/(\*{1,2}|_{1,2}|`)/g, '').trim();
}

app.post('/search-course', async (req, res) => {
    const query = req.body.query.trim();
    const prompt = `Buatkan daftar judul pembelajaran (Tidak perlu penjelasannya) tentang: `;
    const database = readDatabase();

    const normalizedQuery = query.toLowerCase();
    
    const existingQueryIndex = database.query.findIndex(q => q.query.toLowerCase() === normalizedQuery);
    
    const firstWord = normalizedQuery.split(' ')[0];

    if (existingQueryIndex !== -1) {
        const matchedTitles = database.title_course.filter(title => 
            title.title.toLowerCase().startsWith(normalizedQuery) &&
            (title.title.length === normalizedQuery.length || title.title[normalizedQuery.length] === ' ')
        );

        return res.json({ titles: matchedTitles });
    }

    try {
        const response = await axios.get(`https://api.i-as.dev/api/gemini/${encodeURIComponent(prompt + query)}`);
        if (!response.data || !response.data.text) {
            throw new Error('Invalid response from AI API');
        }

        const recommendations = response.data.text.split('\n').filter(title => title.trim() !== '');

        const id_query = database.query.length + 1;
        database.query.push({ id_query, query });

        const titles = recommendations.map((title, index) => ({
            id_title_course: index + 1,
            title: `${query} | ${cleanMarkdown(title)}`
        }));

        database.title_course.push(...titles);
        saveDatabase(database);

        const matchedNewTitles = titles.filter(title => 
            title.title.toLowerCase().startsWith(normalizedQuery) &&
            (title.title.length === normalizedQuery.length || title.title[normalizedQuery.length] === ' ')
        );

        res.json({ titles: matchedNewTitles });
    } catch (error) {
        console.error('Error fetching AI recommendations:', error);
        res.status(500).json({ error: 'Failed to get course recommendations' });
    }
});


app.post('/generate-content', async (req, res) => {
    const { title, query } = req.body;

    if (typeof title !== 'string' || title.trim() === '') {
        return res.status(400).json({ error: 'Title is required and must be a string.' });
    }

    const prompt = `Gunakan bahasa Gaul dan buat pembelajaran tentang: `;
    const database = readDatabase();

    const existingTitles = database.title_course.map(t => ({ title: t.title, id_title_course: t.id_title_course }));
    
    const threshold = 3;
    const closeMatch = existingTitles.find(existing => 
        levenshtein.get(existing.title.toLowerCase(), title.toLowerCase()) <= threshold
    );

    let id_title_course;

    if (closeMatch) {
        id_title_course = closeMatch.id_title_course;

        const existingContent = database.course.find(c => c.id_title_course === id_title_course);
        if (existingContent) {
            return res.json({ content: existingContent.course });
        }
    } else {
        id_title_course = database.title_course.length + 1;
        database.title_course.push({ id_query: null, id_title_course, title });
    }

    try {
        const response = await axios.get(`https://api.i-as.dev/api/gemini/${encodeURIComponent(prompt + title)}`);
        if (!response.data || !response.data.text) {
            throw new Error('Invalid response from AI API');
        }
        const content = response.data.text;

        const id_course = database.course.length + 1;
        database.course.push({ id_course, id_title_course, course: content });
        saveDatabase(database);
        
        res.json({ content });
    } catch (error) {
        console.error('Error fetching AI content:', error);
        res.status(500).json({ error: 'Failed to generate course content' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
