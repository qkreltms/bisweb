/*  LICENSE
 
 _This file is Copyright 2018 by the Image Processing and Analysis Group (BioImage Suite Team). Dept. of Radiology & Biomedical Imaging, Yale School of Medicine._
 
 BioImage Suite Web is licensed under the Apache License, Version 2.0 (the "License");
 
 - you may not use this software except in compliance with the License.
 - You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
 
 __Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.__
 
 ENDLICENSE */

const io = require('bis_genericio');
let endASCII = 'z'.charCodeAt(0);

/**
 * Takes a series of actions and forms a sequence parseable by 'make'. 
 * 
 * @param {String} filename - Name of file containing JSON that specifies the inputs, outputs, and jobs
 * @param {String} location - Where to write the file to. Note that file save dialog opens for browser regardless.
 * @return The Makefile for the set of jobs.
 */
let makePipeline = function(filename, location) {
    io.read(filename).then((file) => {
        let parsedFile;
        try {
            parsedFile = JSON.parse(file.data);
        } catch (e) {
            console.log('Could not parse file', e);
            parsedFile = file;
            console.log('parsedFile', file);
            return null;
        }

        let defaultCommand = parsedFile.command ? parsedFile.command : "node bisweb.js";

        //--------------------------------------------------------------------------------------------------------
        // Scan input file for proper formatting
        //--------------------------------------------------------------------------------------------------------
        
        //check to see if appendText and name for each job are unique
        let appendTexts = {}, names = {};
        for (let job of parsedFile.jobs) {
            let appendText = job.appendText, name = job.name;

            if (!name) {
                if (appendText) {
                    console.log('Error: job with appendText', appendText, 'does not have a name');
                } else {
                    console.log('Error: job', job, 'does not have a name or appendText');
                }
               
                return false;
            } 
            
            if (!appendText) {
                console.log('Error: job with name', name, 'does not have an appendText');
                return false;
            }

            if (!appendTexts[appendText] && !names[name]) { 
                appendTexts[appendText] = { 'text' : appendText, 'subcommand' : job.subcommand, 'name' : name};
                names[name] = name;
            } else {
                let duplicate = appendTexts[appendText] ? appendTexts[appendText].name : names[name];
                console.log('Error: appendTexts and names of jobs must be unique. Jobs', duplicate, 'and', job.name, 'have same appendText or name.');
                return false;
            }
        }

        let expandedVariables = {};

        //inputs, outputs, and formatted commands for EACH command produced by EACH job
        let allJobOutputs = [];
        
        //the commands associated with EACH job in object form { 'job' : [job name], 'outputs' : [output files produced by job]}
        let jobsWithOutputs = [];

        for (let job of parsedFile.jobs) {

            //the entry in jobsWithOutputs for this job
            let jobWithOutputs = {
                'name' : job.name.toLowerCase(),
                'outputs' : []   
            };

            let variablesReferencedByCurrentJob = []; //variables resolved in scope of current job are used to generate output names appropriate to the current job
            let inputsUsedByJob = [];

            //a variable is generated by a job if the symbolic reference to that variable first appears in that job, e.g. if you have a variable 'out1', if it is first referenced by a job 'job1' then out1 is considered a variable generated by job1
            let variablesGeneratedByJob = [];
            let variablesWithDependencies = [];

            //construct array of variables from array of options
            let optionsArray = job.options.split(' ');
            for (let option of optionsArray) {

                //add a key to the expanded variable map for each variable specified in the job's options
                //variables are denoted as keys of variables specified in JSON surrounded by '%'. 
                if (option.charAt(0) === '%' && option.charAt(option.length - 1) === '%') {
                    let variableName = stripVariable(option);
                    variablesReferencedByCurrentJob.push(variableName);
                    if (!expandedVariables[variableName]) expandedVariables[variableName] = [];
                }
            }

            //expand variable names into arrays
            for (let variableName of variablesReferencedByCurrentJob) {

                //find appropriate entry in variables specified in JSON
                for (let j = 0; j <= parsedFile.variables.length; j++) {

                    //return an error if we reach the end without finding the variable
                    if (j === parsedFile.variables.length) {
                        console.log('Variable ' + variableName + ' is not contained in the file ' + filename);
                        return false;
                    }

                    if (parsedFile.variables[j].name === variableName) {
                        //let variable = parsedFile.variables[j];
                        
                        //a variable with its files specified should be added to the dictionary of expanded variables
                        //the fact that its files are present already also indicates that it is an input 
                        if (parsedFile.variables[j].files && expandedVariables[variableName].length === 0) {
                            expandedVariables[variableName] = parsedFile.variables[j].files;
                            inputsUsedByJob.push({ 'name' : variableName, 'index' : j});
                        } 
                        
                        //expand list of dependencies, if necessary.
                        else if (parsedFile.variables[j].depends) {
                            variablesWithDependencies.push({ 'name': variableName, 'index': j });
                        }

                        j = parsedFile.variables.length + 1;
                    }
                }
            }

            //expand dependencies into lists of files if necessary and parse variables used by the job into input and output
            //note that an input is any variable that has its file list available to the job (this relies on jobs being specified in the order in which they run in the JSON file)
            let numOutputs;
            for (let variable of variablesWithDependencies) {
                //if names have already been generated then the output is produced by a node upstream, so don't overwrite the names
                if (expandedVariables[variable.name].length === 0) {
                    let dependencies = parsedFile.variables[variable.index].depends;
                    //let fileExtension = parsedFile.variables[variable.index].extension;
                    for (let dependency of dependencies) {
                        dependency = stripVariable(dependency);

                        if (!expandedVariables[dependency]) {
                            console.log("Error: dependency", dependency, "cannot be resolved by job", job.command);
                            return false;
                        }

                        //a variable will either contain one reference or many. 
                        //if multiple are specified then exactly that many outputs will be produced -- it is expected that variables are specified in only one amount different than 1 
                        if (expandedVariables[dependency].length > 1) {
                            numOutputs = expandedVariables[dependency].length;
                        }

                    }

                    //generate output names
                    let outputFilenames = [], currentASCII = 'a';
                    for (let i = 0; i < numOutputs; i++) {
                        let outputFilename = currentASCII + '_' + job.appendText + '.o' + fileExtension;
                        outputFilenames.push(outputFilename);
                        currentASCII = getNextASCIIChar(currentASCII);
                    }

                    expandedVariables[variable.name] = outputFilenames;
                    variablesGeneratedByJob.push(variable);
                } else {
                    inputsUsedByJob.push(variable);
                }
            }


            //replace entry in optionsArray with appropriate expanded variable
            for (let i = 0; i < optionsArray.length; i++) {
                let option = optionsArray[i];
            
                if (option.charAt(0) === '%' && option.charAt(option.length-1) === '%') {
                    let variable = stripVariable(option);
                    optionsArray[i] = expandedVariables[variable];
                }

            }


            //construct the inputs, outputs, and command in the way that 'make' expects
            for (let i = 0; i < numOutputs; i++) {
                let commandArray = [], formattedJobOutput = { 'inputs' : [], 'outputs' : [], 'command' : undefined };
                for (let option of optionsArray) {
                    //add appropriate entry from expanded variable if necessary
                    let expandedOption = Array.isArray(option) ? ( option.length > 1 ?  option[i] : option[0]) : option;
                    commandArray.push(expandedOption);
                }

                inputsUsedByJob.forEach( (input) => {
                    input = expandedVariables[input.name].length > 1 ? expandedVariables[input.name][i] : expandedVariables[input.name][0];
                    formattedJobOutput.inputs.push(input);
                });

                variablesGeneratedByJob.forEach( (output) => {
                    output = expandedVariables[output.name].length > 1 ? expandedVariables[output.name][i] : expandedVariables[output.name][0];
                    formattedJobOutput.outputs.push(output);
                    jobWithOutputs.outputs.push(output);
                });

                //command can either be the default command, the command specified for the set of jobs, or the command specified for an individual job.
                //the command for an individual job takes highest precedence, then the command for the set, then the default.
                let command = job.command ? job.command : defaultCommand;

                formattedJobOutput.command = command + ' ' + job.subcommand + ' ' + commandArray.join(' ');
                allJobOutputs.push(formattedJobOutput);
            }

            jobsWithOutputs.push(jobWithOutputs);
        }

        //add 'make all' 
        let makefile = '.PHONY: all\nall : ';
        for (let o of allJobOutputs) {
            for (let output of o.outputs) { 
                makefile = makefile + output + ' ';
            }
        }

        //add 'make clean'
        makefile = makefile + '\n\n.PHONY: clean\nclean:\n\trm -f *.o.*\n\n';

        //add 'make [job]' for each job
        for (let job of jobsWithOutputs) {
            let name = job.name.toLowerCase();
            makefile += '.PHONY: ' + name + '\n' + name + ' : ';

            for (let output of job.outputs) {
                makefile += output + ' ';
            }
            makefile += '\n\n';
        }

        //make the rest of the commands with job names set to the name of outputs
        for (let o of allJobOutputs) {
            for (let output of o.outputs) {
                makefile += output + ' : ' + o.inputs.join(' ') + '\n\t' + o.command + '\n\n';
            }
        }

        console.log('makefile', makefile);

        io.write(location, makefile).then( () => {
            console.log('Wrote Makefile to', location, 'successfully');
        }).catch( (e) => { console.log('An error occured', e); return null; }); 
    }).catch( (e) => { console.log('An error occured', e); return null; });

};

let stripVariable = function (variable) {
    return variable.slice(1, variable.length - 1);
};

let getNextASCIIChar = function (a) {
    let ASCIICode = a.charCodeAt(a.length - 1);
    if (ASCIICode === endASCII) return 'a'.concat(a);

    return String.fromCharCode(ASCIICode + 1);
};

/*let getFileExtension = function (type) {
    switch (type) {
        case 'image': return '.nii.gz';
        case 'matrix': return '.matr';
        case 'transform':
        case 'transformation': return '.grd';
    }
};*/


module.exports = {
    makePipeline: makePipeline
};
