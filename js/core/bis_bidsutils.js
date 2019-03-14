'use strict';

const bis_genericio = require('bis_genericio');
const colors=bis_genericio.getcolorsmodule();

// DICOM2BIDS
/**
 * Performs NII 2 Bids conversion on data generated by dcm2nii. 
 * When finished, the files will be placed in the specified output directory in a folder named 'source'. See BIDS specifications for more details on file structure. 
 * This function will also calculate checksums for each of the NIFI images before returning. This is to ensure data integrity. 
 * 
 * @param {Dictionary} opts  - the parameter object
 * @param {String} opts.indir - the input directory (output of dcm2nii)
 * @param {String} opts.outdir - the output directory (output of this function)
 * @returns {Promise} -- when done with payload the list of converted files
 */
let dicom2BIDS = async function (opts) {


    let errorfn = ((msg) => {
        console.log('Error=', msg);
        return msg;
    });

    let makeDir = async function (f) {
        try {
            await bis_genericio.makeDirectory(f);
        } catch (e) {
            if (e.code !== 'EEXIST') {
                errorfn('Error' + e);
                return false;
            } else {
                console.log('Directory Exists Ignoring');
            }
        }
        return true;
    };

    let indir = opts.indir || '';
    let outdir = opts.outdir || '';
    console.log('opts=', opts);


    console.log(colors.yellow('.... Now converting files to BIDS format.'));

    let matchniix = bis_genericio.joinFilenames(indir, '*.nii.gz');
    let matchsupp = bis_genericio.joinFilenames(indir, '*');

    let flist = await bis_genericio.getMatchingFiles(matchniix);
    let suppfiles = await bis_genericio.getMatchingFiles(matchsupp);

    console.log(colors.green('.... Flist : '+flist.join('\n\t')));
    console.log(colors.yellow('... Supporting files : '+suppfiles.join('\n\t')));

    //wait for all files to move and hashes to finish calculating
    let makeHash = calculateChecksums(flist);
    let moveImageFiles = [], moveSupportingFiles = [];



    //filter supplemental files by looking for files without '.nii'.
    //once you find a file and move it, record its name 
    let filteredsuppfiles = [], movedsuppfiles = [];
    for (let file of suppfiles) {
        if (!file.includes('.nii')) filteredsuppfiles.push(file);
    }

    if (flist.length < 1) {
        return errorfn('No data to convert in ' + indir);
    }

    let outputdirectory = bis_genericio.joinFilenames(outdir, 'source');
    try {
        await makeDir(outputdirectory);
        console.log(colors.green('....\nCreated output directory : '+outputdirectory));
    } catch (e) {
        return errorfn('Failed to make directory ' + e);
    }



    let funcdir = bis_genericio.joinFilenames(outputdirectory, 'func');
    let anatdir = bis_genericio.joinFilenames(outputdirectory, 'anat');
    let locdir = bis_genericio.joinFilenames(outputdirectory, 'localizer');
    let diffdir = bis_genericio.joinFilenames(outputdirectory, 'diff');

    try {
        makeDir(funcdir);
        makeDir(anatdir);
        makeDir(diffdir);
        makeDir(locdir);
    } catch (e) {
        return errorfn('failed to make directory' + e);
    }

    let maxindex = flist.length;
    let tlist = [];
    for (let i = 0; i < maxindex; i++) {

        let name = flist[i];
        let dirname = anatdir;
        let tname = name.toLowerCase();

        if (tname.indexOf('bold') > 0 || tname.indexOf('asl') > 0) {
            dirname = funcdir;
        } else if (tname.indexOf('localizer') > 0) {
            dirname = locdir;
        } else if (tname.indexOf('.bval') > 0 || tname.indexOf('.bvec') > 0) {
            // DTI helper files
            dirname = diffdir;
        } else if (tname.indexOf('.nii.gz') > 0) {
            let f2 = name.substr(0, name.length - 7);
            let f3 = f2 + '.bval';
            console.log(name, ',', f2, '->', f3);
            if (flist.indexOf(f3) >= 0)
                dirname = diffdir;
        }

        let origname = name;
        let basename = bis_genericio.getBaseName(name);

        let splitName = basename.split('.')[0];

        for (let suppfile of filteredsuppfiles) {
            //check if the trailing parts of one of the support files (without file type) match the image
            //strip out file extension and the name of the parent folder to match image
            let splitsupp = bis_genericio.getBaseName(suppfile).split('.');
            let filebasename = splitsupp[0];

            if (splitName.toLowerCase() === filebasename.toLowerCase()) {
                //rejoin file extension to the formatted splitsupp
                let suppTarget = bis_genericio.joinFilenames(dirname, bis_genericio.getBaseName(suppfile));
                movedsuppfiles.push(suppTarget);
                moveSupportingFiles.push(bis_genericio.copyFile(suppfile + '&&' + suppTarget));
            }
        }

        let target = bis_genericio.joinFilenames(dirname, basename);

        try {
            moveImageFiles.push(bis_genericio.copyFile(origname + '&&' + target));
        } catch (e) {
            console.log('copy file', e);
            return errorfn(e);
        }
        tlist.push(target);
    }

    //date will be a 14 character string in the middle of a filename
    let dateRegex = /\d{14}/g;
    let fileString = flist[0];
    let dateMatch = dateRegex.exec(fileString);
    let date = dateMatch[0];

    //separate date string into individual chunks
    let year = date.substring(0, 4), month = date.substring(4, 6), day = date.substring(6, 8), hour = date.substring(8, 10), minute = date.substring(10, 12);

    let outfilename = bis_genericio.joinFilenames(outputdirectory, 'dicom_job.json');
    let outobj = {
        "bisformat": "DICOMImport",
        "bidsversion": "1.1.0",
        "description": `DICOM Dataset generated on ${month}/${day}, ${year} at ${hour}:${minute}`,
        "job": [],
    };

    for (let i = 0; i < tlist.length; i++) {
        let fname = tlist[i];
        let name = bis_genericio.getBaseName(tlist[i]);
        let infoname = '';
        if (name.indexOf(".nii.gz") > 0) {

            let tagname = bis_genericio.getBaseName(bis_genericio.getDirectoryName(fname));

            name = name.substr(0, name.length - 7);
            let f2 = fname.substr(0, fname.length - 7) + '.bvec';
            let ind2 = tlist.indexOf(f2);

            if (ind2 >= 0) {
                infoname = tlist[ind2];
                tagname = "DTI";
            } else {
                if (tagname === 'functional') {
                    tagname = 'Functional';
                } else if (tagname === 'diffusion') {
                    tagname = 'DTI';
                } else if (tagname === 'anatomical') {
                    if (fname.indexOf('3D') >= 0 || fname.indexOf('3d') > 0) {
                        tagname = '3DAnatomical';
                    } else {
                        tagname = 'Anatomical';
                    }
                } else {
                    tagname = 'None';
                }
            }

            //find supporting files from file list 
            let basename = name.split('.')[0], suppfileArray = [];
            for (let file of movedsuppfiles) {
                if (file.includes(basename)) {
                    let splitName = file.split('/');
                    //parse the raw filename for only the BIDS components
                    //BIDS structuring should produce a filepath at least two entries long (BIDS subdirectory and filename), so if this isn't the case we want to let the user know
                    let bidsName = (splitName.length >= 2 ? splitName.slice(splitName.length - 2, splitName.length).join('/') : 'Error: BIDS structure was not created correctly!');
                    suppfileArray.push(bidsName);
                }
            }

            outobj.job.push({
                name: name,
                filename: fname.substr(outputdirectory.length + 1, fname.length),
                tag: tagname,
                hash: 'TODO: fill this!',
                supportingfiles: suppfileArray,
                details: infoname
            });

        }
    }

    try {
        let promiseArray = Array.apply(moveImageFiles, moveSupportingFiles);

        let checksums = await makeHash;
        for (let prom of promiseArray) { await prom; }

        //put checksums in dicom_job then write it to disk
        for (let val of checksums) {
            for (let fileEntry of outobj.job) {
                if (val.output.filename.includes(fileEntry.name)) {
                    fileEntry.hash = val.output.hash;
                    break;
                }
            }
        }

        await bis_genericio.write(outfilename, JSON.stringify(outobj, null, 2), false);

        console.log('----- output directory', outputdirectory);

        return outputdirectory;

    } catch (e) {
        return errorfn(e);
    }



};

/**
 * Calculates checksums for each of the NIFTI files in the BIDS directory.
 * 
 * @param {Array} inputFiles - Names of NIFTI files 
 * @returns Promise that will resolve once images have been checksummed.
 */
let calculateChecksums = (inputFiles) => {

    return new Promise((resolve, reject) => {
        let promises = [];
        for (let file of inputFiles) {
            promises.push(bis_genericio.makeFileChecksum(file));
        }

        Promise.all(promises)
            .then((values) => { console.log('done calculating checksums'); resolve(values); })
            .catch((e) => { reject(e); });
    });

};


module.exports = {
    dicom2BIDS: dicom2BIDS
};
