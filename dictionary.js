// declare mongo collections globally
Tasks = new Mongo.Collection("tasks");
Kanji = new Mongo.Collection("kanji");

// server end js code
if (Meteor.isServer){
    Meteor.startup(function () {
        // cheerio for parsing html
        var cheerio = Meteor.npmRequire('cheerio');
        Meteor.methods({
            getData: function (original_query) {
                // test if query is romaji/english
                if(/^[a-zA-Z0-9- ]*$/.test(original_query) == true){
                    cresult = Meteor.http.get(
                        "http://tangorin.com/general/"+original_query
                    );
                    $ = cheerio.load(cresult.content);
                    original_query = $('rb').contents()[0]['data'];
                }
                // encode query for html safe Japanese characters
                query = encodeURIComponent(original_query);
                // get disambiguation table from Goo
                qresult = Meteor.http.get("http://dictionary.goo.ne.jp/srch/thsrs/"+query+"/m0u/");
                $ = cheerio.load(qresult.content);
                if ($(".list-search-a-in").length > 0){
                    var first_result = $(".list-search-a a").attr("href");
                    qresult = Meteor.http.get("http://dictionary.goo.ne.jp" + first_result);
                    $ = cheerio.load(qresult.content);
                }
                var table = $('.comparisonTable').html();
                // get accent data from OJAD;
                ojad_result = Meteor.http.get(
                    "http://www.gavo.t.u-tokyo.ac.jp/ojad/search/index/display:print/"+
                    "sortprefix:accent/narabi1:kata_asc/narabi2:accent_asc/narabi3:mola_asc/"+
                    "yure:visible/details:invisible/limit:3/word:" + query
                ); 
                $ = cheerio.load(ojad_result.content);
                var accent = []; // array in case of multiple pronunciations
                $('.katsuyo.katsuyo_jisho_js div.katsuyo_proc p').each(function(){
                    accent.push($(this).html()); // push to array
                });
        
                // get definitions
                weblio_result = Meteor.http.get("http://ejje.weblio.jp/content/"+query);
                $ = cheerio.load(weblio_result.content);
                var definition = [];
                // each different reading e.g. いちばandしじょう
                $('.Kejje').each(function(){
                    var $this = $(this);
                    var subdef = []
                    var reading = $(this).prev().text().replace(original_query,'');
                    // loop through all level0 and level1
                    $this.children('.level0, .level1').each(function(){
                        var classname = $(this).attr("class");
                        if (classname == 'level0') {
                            //var jtopic = $(this).find('.lvlNBje tr').text();
                            var jtopic = [];
                            $(this).find('.lvlNBje tr').each(function(){
                                jtopic.push($(this).text());
                            });
                            var etopic = [];
                        }
                        else {
                            var jtopic = $(this).children('.lvlBje').text();
                            var etopic = [];
                            $(this).find('.kenjeEnE').each(function(){
                                etopic.push($(this).text());
                            });
                        }
                        subdef.push({ 
                            classname: classname,
                            jtopic: jtopic,
                            etopic: etopic
                        });
                    });
                    definition.push({
                        reading:reading,
                        subdef:subdef
                    });
                });
        
                var meaning = "";
                // synonyms


                // kanji
                var kanjis = original_query.match(/[\u4E00-\u9FFF\uF900-\uFAFF\u3400-\u4DBF]/g);
                if (kanjis) {
                    if (kanjis.length > 0){ 
                        kanjis.forEach(function findKanji(value){       
                            var kcount = Kanji.find({kanji:value}).count();
                            if (kcount == 0) {
                                console.log('writing to mongo');
                                kresult = Meteor.http.get("http://tangorin.com/kanji/"+value);
                                $ = cheerio.load(kresult.content);
                                $('.romaji').remove();
                                var kreading = $('.k-readings').html();
                                var pinyin = $('span.pinyin').text();
                                // add record to mongo kanji collection
                                Kanji.insert({
                                    character: value,
                                    meaning: kreading,
                                    pinyin: pinyin,
                                    createdAt: new Date() // current time
                                });
                            }
                        });
                    }
                }

                // return dictionary with results
                return {
                    table: table,
                    accent: accent,
                    meaning: meaning,
                    definition: definition,
                    kanji: kanjis,
                };
            },
        })
    });
}

// client end js code
if (Meteor.isClient) {
    Template.body.helpers({
        tasks: function (query) {
            return Tasks.find({text:query}, {sort: {createdAt: -1}});
        },
        incompleteCount: function () {
            return Tasks.find({checked: {$ne: true}}).count();
        },
        query: function(){
            return Session.get('query');
        }
    }); 
 
    Template.body.events({
        "submit .new-task": function (event) {
            // Prevent default browser form submit
            event.preventDefault();
 
            // Get value from form element
            var text = event.target.text.value;
            Session.set('query', text);
              
            // Search for existing term
            var result_count = Tasks.find({
                text: text
            }).count();             
                
            // Insert a task into the collection
            if (result_count == 0) {
                Meteor.call('getData', text, function(error,result){
                    Tasks.insert({
                        text: text,
                        table: result.table,
                        accent: result.accent,
                        meaning: result.meaning,
                        definition: result.definition,
                        kanji: result.kanji,
                        createdAt: new Date() // current time
                    });
                });
            }
            // Clear form
            event.target.text.value = "";
        },
        "change .hide-completed input": function (event) {
            Session.set("hideCompleted", event.target.checked);
        }
    });
 
    Template.task.helpers({
        kanji_list: function(kanji) {
            if (kanji){
                var kanji_object = Kanji.findOne({character:kanji});
                return kanji_object.meaning;
                        
            }
        },
        pinyin_list: function(kanji) {
            if (kanji){

                var kanji_object = Kanji.findOne({character:kanji});
                return kanji_object.pinyin;
            }
        }

    });
 
    Template.task.events({
        "click .toggle-checked": function () {
        // Set the checked property to the opposite of its current value
            Tasks.update(this._id, {
                $set: {checked: ! this.checked}
            });
        },
        "click .delete": function () {
            Tasks.remove(this._id);
        }
    });
}
