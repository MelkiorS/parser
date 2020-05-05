const Category = require('../models/category')
const Dictionary = require('../models/dictionary')
const nodemailer = require('nodemailer');
const keys = require('../config/keys')
const translate = require('@vitalets/google-translate-api');
const cacheCtrl = require('../controllers/cache')

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: keys.email,
        pass: keys.emailPwd
    }
});

//TODO refactor to atomic operations
async function saveCategory(category) {
    const query = {name: category.name}
    const update = {subCategory: category.subCategory}
    const options = {upsert: true, new: true};
    try {
        return await Category.findOneAndUpdate(query, update, options,
            function (err, doc) {
                if (err) throw err
                if (!doc) {
                    doc = new Category(category)
                    doc.save()
                }
            })
    } catch (e) {
        throw new Error(`Load Category error = ${e}`)
    }
}

module.exports.loadCategories = async function () {
    try {
        return await Category.find()
    } catch (e) {
        throw new Error(`Load Category error = ${e}`)
    }
}

module.exports.loadDictionary = async function () {
    try {
        return await Dictionary.findOne({lang: 'he'})
    } catch (e) {
        throw new Error(`Load Dictionary error = ${e}`)
    }
}

module.exports.saveCategories = async function (categoryList) {
    categoryList.forEach(cat => saveCategory(cat))
}

module.exports.checkCategories = function (categories) {
    const cashed = cacheCtrl.cacheCategories()
    const newestCat = []
    const allChangedCat = []
    categories.forEach(cat => {
        const cashedCategory = cashed.find(c => c.name === cat.name)
        if (cashedCategory) {
            const {newestSubCat, allChangedSubCat} =
                checkSubCategories(cat.subCategory, cashedCategory.subCategory)

            if (newestSubCat.length) {
                const updatedCat = getUpdatedCat(cat, newestSubCat)
                newestCat.push(updatedCat)
                allChangedCat.push(updatedCat)
            }
            if (allChangedSubCat.length) {
                const updatedCat = getUpdatedCat(cat, allChangedSubCat)
                allChangedCat.push(updatedCat)
            }
        } else {
            const {newestSubCat} =
                checkSubCategories(cat.subCategory, [])
            const updatedCat = getUpdatedCat(cat, newestSubCat)
            newestCat.push(updatedCat)
            allChangedCat.push(updatedCat)
        }
    })
    return {newestCat, allChangedCat}
}

function getUpdatedCat(cat, subCategory) {
    return {...cat, subCategory}
}

function getUpdatedSubCat(subCat,count) {
    return {...subCat,count}
}

function checkSubCategories(subCategory, cashedSubCategory) {
    const newestSubCat = []
    const allChangedSubCat = []
    subCategory.forEach(subCat => {
        const cashedSubCat = cashedSubCategory.find(sc => sc.name === subCat.name)
        if (cashedSubCat) {
            if (subCat.deals > cashedSubCat.deals) {
                const count = subCat.deals - cashedSubCat.deals
                const updatedSubCat = getUpdatedSubCat(subCat, count)
                newestSubCat.push(updatedSubCat)
                allChangedSubCat.push(updatedSubCat)
            } else if (subCat.deals < cashedSubCat.deals) {
                const updatedSubCat = getUpdatedSubCat(subCat, subCat.deals)
                allChangedSubCat.push(updatedSubCat)
            }
        } else {
            const updatedSubCat = getUpdatedSubCat(subCat, subCat.deals)
            newestSubCat.push(updatedSubCat)
            allChangedSubCat.push(updatedSubCat)
        }
    })
    return {newestSubCat, allChangedSubCat}
}

module.exports.updateCacheCategories = function(cachedCategories,categories){
    categories.forEach(cat => {
        const cashedCat = cachedCategories.find(c => c.name === cat.name)
        if (cashedCat) {
            cat.subCategory.forEach(subCat=>{
                const cashedSubCat = cashedCat.subCategory.find(sc => sc.name === subCat.name)
                if (cashedSubCat) {
                    Object.assign(cashedSubCat, subCat);
                } else {
                    const updatedSubCat = getUpdatedSubCat(subCat, subCat.deals)
                    cashedCat.subCategory.push(updatedSubCat)
                }
            })

        } else {
            const {allChangedSubCat} = checkSubCategories(cat.subCategory, [])
            const updatedCat = getUpdatedCat(cat, allChangedSubCat)
            cachedCategories.push(updatedCat)
        }
    })
}

module.exports.notifyAboutNewDeal = function (categories) {

    let message = '<h1>categories:</h1>\n'
    categories.forEach(cat => {
        message += `    <h2>${cat.name}</h2>\n`
        cat.subCategory.forEach(subCat => {
            message += `        <h3>${subCat.name}</h3>\n`
            message += `        <a href=" ${keys.baseURL + subCat.path}">NEW : ${subCat.count}</a>\n`
        })
    })
    const mailOptions = {
        from: keys.email,
        to: keys.notifyEmail,
        subject: 'NEW INTERESTS',
        html: message
    };
    // console.log(`send email message = \n ${message}`)
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

module.exports.translateCategories = function (categories, dictionary) {
    const lang = dictionary.translator
    const translated = []
    categories.forEach(c => translated.push({...c}))

    translated.forEach(cat => {
        cat.name = lang.get(cat.name.split('.').join('DOT'))
        const subCatTrans = []
        cat.subCategory.forEach(subCat => {
            subCatTrans.push({...subCat, name: lang.get(subCat.name.split('.').join('DOT'))})
        })
        cat.subCategory = subCatTrans
    })

    return translated
}

module.exports.saveDictionary = function (dictionary) {
    const query = {lang: 'he'}
    const update = {translator: dictionary.translator}
    const options = {upsert: true, new: true};
    try {
        Dictionary.findOneAndUpdate(query, update, options,
            function (err, doc) {
                if (err) throw err
                if (!doc) {
                    doc = new Dictionary(dictionary)
                    doc.save()
                }
            })
    } catch (e) {
        throw new Error(`save Dictionary error = ${e}`)
    }

}

module.exports.updateDictionary = async function (categories, dictionary) {
    const lang = dictionary.translator
    for (let i = 0; i < categories.length; i++) {
        const catName = categories[i].name
        if (!lang.get(catName.split('.').join('DOT'))) {
            const catNameTranslated = await translateText(catName)
            lang.set(catName.split('.').join('DOT'), catNameTranslated)
        }
        const subCategory = categories[i].subCategory

        for (let k = 0; k < subCategory.length; k++) {
            const subCatName = subCategory[k].name
            if (!lang.get(subCatName.split('.').join('DOT'))) {
                const subCatNameTranslated = await translateText(subCatName)
                lang.set(subCatName.split('.').join('DOT'), subCatNameTranslated)
            }
        }
    }
}


module.exports.saveAndUpdateDictionary = async function (dictionary, newTranslations) {
    dictionary.translator = new Map([...dictionary.translator, ...newTranslations])
    saveDictionary(dictionary)
    return dictionary
}


async function translateText(text) {
    try {
        console.log(`new text = ${text}`)
        return translate(text, {to: 'en'})
            .then(function (resp) {
                console.log(`translated = ${resp.text}`)
                return resp.text;
            })
    } catch (e) {
        console.log(e)
        throw new e
    }
}
